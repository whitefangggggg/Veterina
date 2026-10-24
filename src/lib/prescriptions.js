export function prescriptionMedications(record) {
  if (Array.isArray(record?.medications) && record.medications.length) return record.medications
  return record ? [{ medicationName: record.medication_name, dose: record.dose, frequency: record.frequency, duration: record.duration || '', instructions: record.instructions || '' }] : []
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
  const credentials = [clinician?.prc_license_number && `PRC ${clinician.prc_license_number}`, clinician?.ptr_number && `PTR ${clinician.ptr_number}`].filter(Boolean).join(' · ')
  const medications = prescriptionMedications(prescription).map((medication) => `<li><strong>${escapeHtml(medication.medicationName)}</strong><p>${[medication.dose, medication.frequency, medication.duration].filter(Boolean).map(escapeHtml).join(' · ')}</p>${medication.instructions ? `<p class="instructions">${escapeHtml(medication.instructions)}</p>` : ''}</li>`).join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Prescription · ${escapeHtml(pet.name)}</title><style>
    *{box-sizing:border-box}body{margin:0;background:#fff;color:#255168;font:12px/1.5 Arial,sans-serif}.sheet{display:flex;flex-direction:column;min-height:254mm}header{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:12mm 12mm 9mm;border-bottom:2px solid #149ee6}h1{margin:0;color:#149ee6;font-size:25px;font-weight:500;overflow-wrap:anywhere}.qualification{margin:3px 0;color:#607d8b;font-size:11px;letter-spacing:2px}.credentials{font-size:11px}.medical-symbol{color:#149ee6;font-size:65px;line-height:1}main{flex:1;padding:8mm 12mm}.patient{display:grid;gap:10px}.detail-row{display:flex;gap:16px}.detail{display:flex;align-items:baseline;gap:8px;flex:1;min-width:0}.detail b{white-space:nowrap;font-size:10px;letter-spacing:.3px}.detail span{flex:1;border-bottom:1px solid #9ab0bb;overflow-wrap:anywhere}.rx{font:52px Georgia,serif;margin:15px 0 5px}ol{padding-left:24px;color:#203c4b}li{padding:4px 0 12px;break-inside:avoid;overflow-wrap:anywhere}li strong{font-size:15px}li p{margin:4px 0;white-space:pre-wrap}.signature{align-self:flex-end;min-width:52mm;margin:18mm 12mm 12mm;text-align:center;break-inside:avoid}.signature-name{padding:0 5px 4px;border-bottom:1px solid #7995a3}.signature small{display:block;letter-spacing:1px}footer{display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:6mm 10mm;border-top:2px solid #149ee6;font-size:10px}footer strong{letter-spacing:2px;text-transform:uppercase}footer span{overflow-wrap:anywhere}@page{size:A4;margin:12mm}@media screen{body{background:#edf1f3;padding:20px}.sheet{max-width:186mm;margin:auto;background:white;box-shadow:0 2px 12px #0001}}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style></head><body><div class="sheet"><header><div><h1>${escapeHtml(clinicianName)}</h1><p class="qualification">VETERINARIAN</p>${credentials ? `<p class="credentials">${escapeHtml(credentials)}</p>` : ''}</div><div class="medical-symbol" aria-hidden="true">⚕</div></header><main><div class="patient"><div class="detail-row">${field('Patient name:', pet.name)}${field('Date:', date)}</div><div class="detail-row">${field('Age:', patientAge(pet.birthDate || pet.birth_date, date) + (pet.birthDateEstimated || pet.birth_date_estimated ? ' (est.)' : ''))}${field('Sex:', pet.sex)}${field('Weight:', visit.weightKg != null ? `${visit.weightKg} kg` : '')}</div><div class="detail-row">${field('Species:', pet.species)}${field('Owner:', owner?.fullName || owner?.full_name)}</div>${field('Diagnosis:', visit.diagnosis)}</div><div class="rx" aria-label="Prescription">℞</div><ol>${medications}</ol></main><div class="signature"><div class="signature-name">${escapeHtml(clinicianName)}</div><small>Signature</small></div><footer><strong>${escapeHtml(clinic?.clinic_name || '')}</strong><span>${escapeHtml(clinic?.address || '')}</span><span>${escapeHtml(clinic?.phone || '')}</span>${clinic?.email ? `<span>${escapeHtml(clinic.email)}</span>` : ''}</footer></div></body></html>`
}

export function printPrescription(context) {
  const frame = document.createElement('iframe')
  frame.title = 'Prescription'
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:1100px;border:0'
  frame.onload = async () => {
    await frame.contentDocument.fonts.ready
    frame.contentWindow.addEventListener('afterprint', () => frame.remove(), { once: true })
    frame.contentWindow.focus()
    frame.contentWindow.print()
  }
  frame.srcdoc = prescriptionHtml(context)
  document.body.appendChild(frame)
}
