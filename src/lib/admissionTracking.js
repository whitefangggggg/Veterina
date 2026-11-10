export const validTrackingCode = (value) => typeof value === 'string' && /^[A-Za-z0-9]{13}$/.test(value)
export const publicAdmissionStatuses = { admitted: 'Admitted', under_treatment: 'Under Treatment', ready_for_discharge: 'Ready for Discharge', discharged: 'Discharged' }

export function admissionTrackingUrl(code, origin = globalThis.location?.origin) {
  if (!validTrackingCode(code) || !origin) return ''
  try {
    const url = new URL('/track-admission', origin)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return ''
    url.hash = code
    return url.href
  } catch { return '' }
}

export async function admissionTrackingQr(code, origin) {
  const url = admissionTrackingUrl(code, origin)
  if (!url) throw new Error('A valid tracking code and website address are required.')
  const { default: QRCode } = await import('qrcode')
  return { url, image: await QRCode.toDataURL(url, { width: 280, margin: 4, errorCorrectionLevel: 'M' }) }
}

export async function lookupPublicAdmission(code, { signal, section, cursor, fetcher = fetch, baseUrl = import.meta.env.VITE_SUPABASE_URL } = {}) {
  if (!validTrackingCode(code)) return { status: 'unavailable' }
  const response = await fetcher(`${baseUrl}/functions/v1/admission-tracking`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: code, ...(section ? { section, ...(cursor ? { cursor } : {}) } : {}) }), cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal,
  })
  if (response.status === 404) return { status: 'unavailable' }
  if (response.status === 429) return { status: 'limited' }
  if (!response.ok) throw new Error('Admission tracking is temporarily unavailable. Please try again.')
  const admission = await response.json()
  if (section) {
    if (admission.section !== section || !Array.isArray(admission.page?.items)) throw new Error('Admission tracking is temporarily unavailable. Please try again.')
    return { status: 'ready', page: admission.page }
  }
  if (!publicAdmissionStatuses[admission.status]) throw new Error('Admission tracking is temporarily unavailable. Please try again.')
  return { status: 'ready', admission }
}

export function trackingTime(value, timezone = 'Asia/Manila') {
  if (!value) return ''
  try {
    return `${new Intl.DateTimeFormat('en-GB', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))} (${timezone})`
  } catch { return '' }
}

export function sharingState(sharing, admission, now = Date.now()) {
  if (admission.is_historical || admission.status === 'cancelled') return 'Unavailable'
  if (!sharing?.enabled) return 'Disabled'
  if (Date.parse(sharing.expires_at) <= now || (admission.closed_at && Date.parse(admission.closed_at) + 7 * 86400000 <= now)) return 'Expired'
  return 'Enabled'
}
