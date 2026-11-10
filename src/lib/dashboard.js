import { buildDailyWork, stockAttention } from './dailyWorkflow'

const active = (entry) => ['waiting', 'in_progress'].includes(entry.status)
const time = (value) => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0

export function clinicShift(settings, now = new Date()) {
  const timezone = settings?.timezone || 'Asia/Manila'
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: timezone,
    weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(({ type, value }) => [type, value]))
  const hour = Number(parts.hour)
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const date = new Intl.DateTimeFormat('en', { timeZone: timezone, weekday: 'short', month: 'short', day: 'numeric' }).format(now)
  const hours = settings?.business_hours?.[parts.weekday.toLowerCase()]
  if (hours?.closed === true) return { greeting, date, status: 'closed', label: 'Closed today' }
  const valid = (value) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value || '')
  if (!valid(hours?.open) || !valid(hours?.close) || hours.open >= hours.close) return { greeting, date, status: 'unknown', label: 'Hours not set' }
  const localTime = `${parts.hour}:${parts.minute}`
  const format = (value) => {
    const [h, m] = value.split(':').map(Number)
    return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`
  }
  const open = localTime >= hours.open && localTime < hours.close
  return { greeting, date, status: open ? 'open' : 'closed', label: open ? `Open until ${format(hours.close)}`
    : localTime < hours.open ? `Opens at ${format(hours.open)}` : 'Closed for today' }
}

export function incompleteCharts(data, actorId) {
  const queues = (data.queueEntries || []).filter(active)
  const visitQueues = new Map(queues.filter((entry) => entry.visit_id).map((entry) => [entry.visit_id, entry]))
  const cards = (data.visits || []).filter((visit) => !visit.finalizedAt && !visit.admissionId
    && visit.recordingPurpose !== 'admission' && visit.careQueue?.status !== 'cancelled').map((visit) => {
    const entry = visitQueues.get(visit.id)
    return { id: `visit-${visit.id}`, petId: visit.petId, visit, entry,
      at: entry?.draftSavedAt || visit.visitedAt, description: entry?.careDraft?.complaint || visit.complaint || visit.type,
      mine: (entry?.veterinarianId || visit.veterinarianId) === actorId, draft: Boolean(entry?.draftSavedAt) }
  })
  const included = new Set(cards.map((card) => card.entry?.id).filter(Boolean))
  for (const entry of queues) {
    if (!entry.draftSavedAt || included.has(entry.id)) continue
    cards.push({ id: `draft-${entry.id}`, petId: entry.petId, entry, at: entry.draftSavedAt,
      description: entry.careDraft?.complaint || entry.service, mine: entry.veterinarianId === actorId, draft: true })
  }
  return cards.sort((a, b) => Number(b.mine) - Number(a.mine) || Number(b.draft) - Number(a.draft) || time(a.at) - time(b.at) || a.id.localeCompare(b.id))
}

export function dashboardWork(data, actorId, now = new Date()) {
  const { care, calls } = buildDailyWork(data, now)
  const priority = (item) => item.category === 'Vaccines' ? 0 : item.category === 'Medicine' ? 1 : 2
  const stock = stockAttention(data.inventory || [], data.today).sort((a, b) =>
    // Expired products stay urgent; then stockouts and clinical products.
    Number(Boolean(b.expired.length)) - Number(Boolean(a.expired.length))
    || Number(priority(b.item) < 2) - Number(priority(a.item) < 2)
    || Number(b.item.quantity <= 0) - Number(a.item.quantity <= 0)
    || priority(a.item) - priority(b.item) || Number(b.lowStock) - Number(a.lowStock) || a.item.name.localeCompare(b.item.name))
  const appointments = (data.appointments || []).filter((item) => item.date === data.today && !['Cancelled', 'No Show'].includes(item.status))
    .sort((a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id))
    .map((appointment) => ({ ...appointment, arrival: (data.queueEntries || []).find((entry) => entry.appointmentId === appointment.id && entry.status !== 'cancelled') }))
  return { waiting: care.filter((entry) => entry.status === 'waiting'), inCare: care.filter((entry) => entry.status === 'in_progress'),
    ready: (data.admissions || []).filter((stay) => stay.status === 'ready_for_discharge' && !stay.is_historical),
    charts: incompleteCharts(data, actorId), calls: calls.filter((item) => ['Due', 'Overdue'].includes(item.status)), stock, appointments }
}

export function appointmentTime(value) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value || '')) return 'Time unavailable'
  const [hour, minute] = value.split(':').map(Number)
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`
}
