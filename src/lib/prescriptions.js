import { isClinicLogoDataUrl } from './clinicLogo'

export function prescriptionInventoryBatches(item, today) {
  return item?.batches.filter((batch) => batch.is_active && batch.quantity > 0 && (!batch.expiration_date || batch.expiration_date >= today)) || []
}

export function prescriptionMedications(record) {
  if (Array.isArray(record?.medications) && record.medications.length) return record.medications
  return record ? [{ medicationName: record.medication_name, dose: record.dose, route: record.route || '', frequency: record.frequency, duration: record.duration || '', instructions: record.instructions || '' }] : []
}

export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])

function patientAge(birthDate, date) {
  if (!birthDate || birthDate > date) return '—'
  const [by, bm, bd] = birthDate.split('-').map(Number)
  const [y, m, d] = date.split('-').map(Number)
  const months = (y - by) * 12 + m - bm - (d < bd ? 1 : 0)
  return months >= 12 ? `${Math.floor(months / 12)} yr${months >= 24 ? 's' : ''}` : months > 0 ? `${months} mo` : 'Under 1 mo'
}

export function prescriptionHtml({ prescription, pet, visit, clinic, profiles = [], owner }) {
  const clinician = profiles.find((profile) => profile.id === prescription.prescribed_by)
  const clinicianName = prescription.prescribed_by_name || clinician?.full_name || 'Veterinarian'
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: clinic?.timezone || 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(prescription.prescribed_at))
  const field = (label, value) => `<div class="detail"><b>${escapeHtml(label)}</b><span>${escapeHtml(value || '—')}</span></div>`
  const prcNumber = String(clinician?.prc_license_number || '').trim()
  const prcLine = prcNumber ? `<span class="prc-license">PRC License No.: ${escapeHtml(prcNumber)}</span>` : ''
  const credentials = clinician?.ptr_number ? `PTR ${clinician.ptr_number}` : ''
  const branding = isClinicLogoDataUrl(clinic?.logo_data_url)
    ? `<img class="shop-logo" src="${escapeHtml(clinic.logo_data_url)}" alt="${escapeHtml(clinic.clinic_name || 'Shop')} logo">`
    : '<div class="medical-symbol" aria-hidden="true">⚕</div>'
  const medications = prescriptionMedications(prescription).map((medication) => `<li><strong>${escapeHtml(medication.medicationName)}</strong><p>${[medication.dose, `Route: ${medication.route || 'Not recorded'}`, medication.frequency, medication.duration].filter(Boolean).map(escapeHtml).join(' · ')}</p>${medication.instructions ? `<p class="instructions">${escapeHtml(medication.instructions)}</p>` : ''}</li>`).join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Prescription · ${escapeHtml(pet.name)}</title><style>
    *{box-sizing:border-box}body{margin:0;background:#fff;color:#255168;font:12px/1.5 Arial,sans-serif}.sheet{display:flex;flex-direction:column;min-height:254mm}header{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:12mm 12mm 9mm;border-bottom:2px solid #149ee6}h1{margin:0;color:#149ee6;font-size:25px;font-weight:500;overflow-wrap:anywhere}.prc-license{display:block;margin:3px 0;font-size:11px;line-height:1.5;overflow-wrap:anywhere}.qualification{margin:3px 0;color:#607d8b;font-size:11px;letter-spacing:2px}.credentials{font-size:11px}.shop-logo{width:30mm;height:26mm;object-fit:contain;flex-shrink:0}header>div:first-child{min-width:0}.medical-symbol{color:#149ee6;font-size:65px;line-height:1}main{flex:1;padding:8mm 12mm}.patient{display:grid;gap:10px}.detail-row{display:flex;gap:16px}.detail{display:flex;align-items:baseline;gap:8px;flex:1;min-width:0}.detail b{white-space:nowrap;font-size:10px;letter-spacing:.3px}.detail span{flex:1;border-bottom:1px solid #9ab0bb;overflow-wrap:anywhere}.rx{font:52px Georgia,serif;margin:15px 0 5px}ol{padding-left:24px;color:#203c4b}li{padding:4px 0 12px;break-inside:avoid;overflow-wrap:anywhere}li strong{font-size:15px}li p{margin:4px 0;white-space:pre-wrap}.signature{align-self:flex-end;min-width:52mm;margin:18mm 12mm 12mm;text-align:center;break-inside:avoid}.signature-name{padding:0 5px 4px;border-bottom:1px solid #7995a3}.signature small{display:block;letter-spacing:1px}footer{display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:6mm 10mm;border-top:2px solid #149ee6;font-size:10px}footer strong{letter-spacing:2px;text-transform:uppercase}footer span{overflow-wrap:anywhere}@page{size:A4;margin:12mm}@media screen{body{background:#edf1f3;padding:20px}.sheet{max-width:186mm;margin:auto;background:white;box-shadow:0 2px 12px #0001}}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style></head><body><div class="sheet"><header><div><h1>${escapeHtml(clinicianName)}</h1>${prcLine}<p class="qualification">VETERINARIAN</p>${credentials ? `<p class="credentials">${escapeHtml(credentials)}</p>` : ''}</div>${branding}</header><main><div class="patient"><div class="detail-row">${field('Patient name:', pet.name)}${field('Date:', date)}</div><div class="detail-row">${field('Age:', patientAge(pet.birthDate || pet.birth_date, date) + (pet.birthDateEstimated || pet.birth_date_estimated ? ' (est.)' : ''))}${field('Sex:', pet.sex)}${field('Weight:', visit.weightKg != null ? `${visit.weightKg} kg` : '')}</div><div class="detail-row">${field('Species:', pet.species)}${field('Owner:', owner?.fullName || owner?.full_name)}</div>${field('Diagnosis:', visit.diagnosis)}</div><div class="rx" aria-label="Prescription">℞</div><ol>${medications}</ol></main><div class="signature"><div class="signature-name">${escapeHtml(clinicianName)}${prcLine}</div><small>Signature</small></div><footer><strong>${escapeHtml(clinic?.clinic_name || '')}</strong><span>${escapeHtml(clinic?.address || '')}</span><span>${escapeHtml(clinic?.phone || '')}</span>${clinic?.email ? `<span>${escapeHtml(clinic.email)}</span>` : ''}</footer></div></body></html>`
}

async function waitForPrescriptionAssets(document) {
  await document.fonts.ready
  await Promise.all([...document.images].map((image) => image.decode()))
}

export async function printPrescription(context) {
  const frame = document.createElement('iframe')
  frame.title = 'Prescription'
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:1100px;border:0'
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Prescription preparation timed out.')), 15000)
      frame.onload = async () => {
        try {
          await waitForPrescriptionAssets(frame.contentDocument)
          clearTimeout(timeout)
          frame.contentWindow.addEventListener('afterprint', () => frame.remove(), { once: true })
          frame.contentWindow.focus()
          frame.contentWindow.print()
          resolve()
        } catch (error) { clearTimeout(timeout); reject(error) }
      }
      frame.srcdoc = prescriptionHtml(context)
      document.body.appendChild(frame)
    })
  } catch (error) { frame.remove(); throw error }
}

export function prescriptionImageName({ prescription, pet, clinic }) {
  const patient = String(pet.name || 'patient').normalize('NFKC').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'patient'
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: clinic?.timezone || 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(prescription.prescribed_at))
  return `prescription-${patient}-${date}.png`
}

export async function prescriptionImageBlob(context) {
  // Render the same escaped document as printing. Patient details stay in this
  // browser; no image service or external fonts receive prescription data.
  const { toBlob } = await import('html-to-image')
  const frame = document.createElement('iframe')
  frame.title = 'Prescription image export'
  frame.setAttribute('aria-hidden', 'true')
  frame.tabIndex = -1
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:1100px;border:0;pointer-events:none'
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Prescription image preparation timed out.')), 15000)
      frame.onload = () => { clearTimeout(timeout); resolve() }
      frame.onerror = () => { clearTimeout(timeout); reject(new Error('Unable to prepare prescription image.')) }
      frame.srcdoc = prescriptionHtml(context)
      document.body.appendChild(frame)
    })
    await waitForPrescriptionAssets(frame.contentDocument)
    const sheet = frame.contentDocument.querySelector('.sheet')
    const bounds = sheet.getBoundingClientRect()
    const blob = await toBlob(sheet, {
      backgroundColor: '#fff', pixelRatio: 2, fontEmbedCSS: '',
      width: Math.ceil(bounds.width), height: Math.ceil(Math.max(bounds.height, sheet.scrollHeight)),
      style: { margin: '0', boxShadow: 'none' },
    })
    if (!blob?.size) throw new Error('Unable to render prescription image.')
    return blob
  } finally { frame.remove() }
}

export async function downloadPrescriptionImage(context) {
  const blob = await prescriptionImageBlob(context)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  try {
    link.href = url
    link.download = prescriptionImageName(context)
    document.body.appendChild(link)
    link.click()
  } finally {
    link.remove()
    // Let the browser consume the download before releasing the private bytes.
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  }
}
