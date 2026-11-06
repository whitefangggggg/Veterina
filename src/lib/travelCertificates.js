import { isClinicDate } from './dailyWorkflow'
import { isClinicLogoDataUrl } from './clinicLogo'
import { escapeHtml } from './prescriptions'
import { withTravelCertificateQr } from './travelCertificateSharing'

export const isPatientPhotoDataUrl = (value) => typeof value === 'string' && value.length <= 6666720 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)

export const completedTravelVaccinations = (vaccinations, petId, today) => vaccinations.filter((vaccine) => vaccine.petId === petId
  && ['Recorded', 'Completed'].includes(vaccine.careStatus || 'Recorded') && isClinicDate(vaccine.administeredAt) && vaccine.administeredAt <= today)

export function travelCertificateErrors({ pet, owner, issuer, vaccination, travelDate, today }) {
  const errors = []
  if (!pet || pet.status !== 'Active' || !owner?.isActive) errors.push('Select an active pet with an active owner.')
  if (!issuer?.is_active) errors.push('Select active issuing personnel.')
  if (!isClinicDate(travelDate) || travelDate < today) errors.push('Choose today or a future travel date.')
  if (!vaccination || vaccination.petId !== pet?.id) errors.push('Select this pet’s Anti-Rabies vaccination.')
  else {
    if (!['Recorded', 'Completed'].includes(vaccination.careStatus || 'Recorded')) errors.push('The selected vaccination must be completed.')
    if (!isClinicDate(vaccination.administeredAt) || vaccination.administeredAt > today) errors.push('The vaccination date must be on or before issuance.')
    if (!isClinicDate(vaccination.nextDueAt)) errors.push('Record the Anti-Rabies next-dose date in the vaccination record before issuing.')
    else if (vaccination.nextDueAt < today || (isClinicDate(travelDate) && vaccination.nextDueAt < travelDate)) errors.push('Anti-Rabies validity must cover issuance and the planned travel date. Update the vaccination record.')
  }
  return errors
}

export function travelCertificatePreview({ pet, owner, issuer, vaccinations, rabiesVaccinationId, today, travelDate, destination, clinic, patientPhotoDataUrl }) {
  return { reference_number: null, status: 'preview', snapshot: { version: 1, issuedOn: today,
    pet: { name: pet.name, species: pet.species, breed: pet.breed, recordNumber: pet.recordNumber, birthDate: pet.birthDate, birthDateEstimated: pet.birthDateEstimated, photoDataUrl: isPatientPhotoDataUrl(patientPhotoDataUrl) ? patientPhotoDataUrl : null },
    owner: { name: owner.fullName }, issuer: { name: issuer.full_name, title: issuer.job_title, prcLicenseNumber: issuer.prc_license_number, ptrNumber: issuer.ptr_number },
    clinic: { name: clinic?.clinic_name, address: clinic?.address, phone: clinic?.phone, email: clinic?.email, logoDataUrl: clinic?.logo_data_url },
    journey: { date: travelDate, destination: destination.trim() }, rabiesVaccinationId,
    review: { eligible: travelCertificateErrors({ pet, owner, issuer, vaccination: vaccinations.find((entry) => entry.id === rabiesVaccinationId), travelDate, today }).length === 0 },
    vaccinations: completedTravelVaccinations(vaccinations, pet.id, today).map((vaccine) => ({ id: vaccine.id, name: vaccine.vaccine, brand: vaccine.brand, lotNumber: vaccine.lotNumber,
      dose: vaccine.dose, administeredOn: vaccine.administeredAt, validThrough: vaccine.nextDueAt, administeredBy: vaccine.administered_by_name })),
  } }
}

export function certificateAge(birthDate, issuedOn, estimated = false) {
  if (!isClinicDate(birthDate) || !isClinicDate(issuedOn) || birthDate > issuedOn) return 'Not recorded'
  const [by, bm, bd] = birthDate.split('-').map(Number), [iy, im, id] = issuedOn.split('-').map(Number)
  const months = (iy - by) * 12 + im - bm - (id < bd ? 1 : 0)
  const years = Math.floor(months / 12), remainder = months % 12
  const age = years ? `${years} year${years === 1 ? '' : 's'}${remainder ? `, ${remainder} month${remainder === 1 ? '' : 's'}` : ''}` : months ? `${months} month${months === 1 ? '' : 's'}` : 'Under 1 month'
  return age + (estimated ? ' (estimated)' : '')
}

const display = (value) => escapeHtml(value == null || String(value).trim() === '' ? 'Not recorded' : value)
const dateLabel = (value) => isClinicDate(value) ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`)) : 'Not recorded'

export function travelCertificateHtml(certificate) {
  const { pet, owner, clinic, issuer, journey, vaccinations = [], issuedOn, rabiesVaccinationId } = certificate.snapshot
  const rabies = vaccinations.find((vaccine) => vaccine.id === rabiesVaccinationId)
  const field = (label, value) => `<div class="detail"><dt>${escapeHtml(label)}</dt><dd>${display(value)}</dd></div>`
  const vaccineRows = (items) => items.map((vaccine) => `<tr${vaccine.id === rabiesVaccinationId ? ' class="rabies-row"' : ''}><td>${display(vaccine.name)}${vaccine.id === rabiesVaccinationId ? '<small>Selected Anti-Rabies record</small>' : ''}</td><td>${display(vaccine.brand)}<small>Lot: ${display(vaccine.lotNumber)}</small></td><td>${display(dateLabel(vaccine.administeredOn))}</td><td>${display(dateLabel(vaccine.validThrough))}</td><td>${display(vaccine.dose)}<small>${display(vaccine.administeredBy)}</small></td></tr>`).join('')
  const status = certificate.status === 'void' ? `<aside class="status void">VOID CERTIFICATE<p>${display(certificate.void_reason)}</p></aside>` : certificate.status === 'preview' ? '<aside class="status">UNISSUED PREVIEW — no certificate reference allocated</aside>' : ''
  const patientPhoto = `<figure class="patient-photo"><div>${isPatientPhotoDataUrl(pet.photoDataUrl) ? `<img src="${escapeHtml(pet.photoDataUrl)}" alt="Patient photo: ${display(pet.name)}">` : '<span>Not recorded</span>'}</div><figcaption>Patient photo</figcaption></figure>`
  const qr = isClinicLogoDataUrl(certificate.qrDataUrl) ? `<img src="${escapeHtml(certificate.qrDataUrl)}" alt="Scan to view this travel certificate"><figcaption>Scan to view certificate<small>Public access is controlled by the clinic.</small></figcaption>` : `<div class="qr-placeholder">${certificate.status === 'preview' ? 'QR added after issuance' : 'QR not available'}</div>`
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Pet Travel Certificate · ${display(certificate.reference_number || 'Preview')}</title><style>
  *{box-sizing:border-box}body{margin:0;color:#203c32;font:12px/1.55 Arial,sans-serif;background:#fff}.sheet{max-width:190mm;margin:auto}header{display:flex;align-items:center;gap:22px;padding-bottom:20px;border-bottom:2px solid #39745e}.logo{width:24mm;height:24mm;object-fit:contain}header div{flex:1;min-width:0}h1{font-size:23px;line-height:1.2;margin:8px 0}h2{font-size:15px;margin:24px 0 10px}.clinic-name{font-size:17px;font-weight:bold}header p{margin:3px 0}.muted,small{color:#52675d}small{display:block;font-size:10px}dl{display:grid;grid-template-columns:1fr 1fr;gap:10px 22px;margin:16px 0}.detail{min-width:0;border-bottom:1px solid #d5dfd9;padding-bottom:8px}dt{font-size:10px;font-weight:bold;text-transform:uppercase;color:#52675d}dd{margin:3px 0 0;overflow-wrap:anywhere}.status{padding:12px;border:2px solid #8e6a24;background:#fff7e6;font-weight:bold;margin:16px 0}.status p{margin:4px 0;font-weight:normal}.void{border-color:#a13333;color:#8b2626;background:#fff0f0}.rabies-summary{padding:14px;border:1px solid #aac6b7;background:#f2f8f4;margin:18px 0}.rabies-summary p{margin:5px 0}table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:10px}thead{display:table-header-group}th,td{border:1px solid #d5dfd9;padding:8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#edf4ef}tr{break-inside:avoid}.rabies-row{background:#f2f8f4}.signature{margin:30px 0 15px;break-inside:avoid}.signature-line{width:65mm;max-width:100%;border-top:1px solid #52675d;padding-top:8px;margin-top:35px}footer{border-top:1px solid #aac6b7;padding-top:12px;margin-top:22px;font-size:10px;overflow-wrap:anywhere}@page{size:A4;margin:15mm}@media screen{body{padding:22px;background:#f3f6f3}.sheet{padding:24px;background:white;box-shadow:0 3px 18px #183c2d12}header{flex-wrap:wrap}dl{gap:10px}@media(max-width:500px){body{padding:8px}.sheet{padding:14px}dl{grid-template-columns:1fr}h1{font-size:20px}th,td{padding:5px;font-size:9px}}}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.sheet{max-width:none}}
  .patient-details{display:grid;grid-template-columns:minmax(0,1fr) 34mm;gap:20px;align-items:start}.patient-photo{margin:16px 0 0;break-inside:avoid}.patient-photo>div{display:flex;align-items:center;justify-content:center;width:34mm;height:38mm;border:1px solid #d5dfd9;border-radius:6px;padding:4px;color:#52675d;background:#f8faf8}.patient-photo img{display:block;width:100%;height:100%;object-fit:contain}.patient-photo figcaption{text-align:center;font-size:10px;color:#52675d;margin-top:6px}@media screen and (max-width:500px){.patient-details{grid-template-columns:minmax(0,1fr)}.patient-photo{grid-row:1;justify-self:end;margin-bottom:4px}}
  .signature{display:flex;justify-content:space-between;gap:24px;align-items:flex-end}.certificate-qr{margin:0;width:34mm;flex:none;text-align:center;break-inside:avoid}.certificate-qr img{display:block;width:30mm;height:30mm;margin:0 auto 5px}.certificate-qr figcaption{font-size:10px}.certificate-qr small{font-size:9px;line-height:1.4;margin-top:4px}.qr-placeholder{display:grid;place-items:center;min-height:30mm;border:1px dashed #aac6b7;padding:12px;color:#52675d;font-size:10px}@media screen and (max-width:500px){.signature{flex-wrap:wrap}.signature-line{width:50mm}}
  </style></head><body><article class="sheet"><header>${isClinicLogoDataUrl(clinic.logoDataUrl) ? `<img class="logo" src="${escapeHtml(clinic.logoDataUrl)}" alt="${display(clinic.name)} logo">` : ''}<div><div class="clinic-name">${display(clinic.name)}</div><h1>Pet Travel Certificate</h1><p class="muted">Clinic-issued vaccination and travel record</p><p><b>Reference:</b> ${display(certificate.reference_number || 'Unissued preview')}</p></div></header>${status}
  <section class="patient-details"><dl>${field('Date of issuance', dateLabel(issuedOn))}${field('Planned travel date', dateLabel(journey.date))}${field('Destination', journey.destination)}${field('Pet record number', pet.recordNumber)}${field('Pet name', pet.name)}${field('Owner', owner.name)}${field('Species', pet.species)}${field('Breed', pet.breed)}${field('Age at issuance', certificateAge(pet.birthDate, issuedOn, pet.birthDateEstimated))}</dl>${patientPhoto}</section>
  <p>This clinic certifies that the pet identified above has the vaccination records listed below. The issuing personnel reviewed these records for the stated journey.</p>
  <section class="rabies-summary"><strong>Selected Anti-Rabies vaccination</strong><p>${display(rabies?.name)} · ${display(rabies?.brand)} · Lot ${display(rabies?.lotNumber)}</p><p>Vaccinated: ${display(dateLabel(rabies?.administeredOn))}<br>Recorded valid through: ${display(dateLabel(rabies?.validThrough))} (inclusive)</p><p>${certificate.status !== 'preview' || certificate.snapshot.review?.eligible ? 'Recorded vaccination validity covers the issuance and planned travel dates.' : 'Vaccination evidence requires review before issuance.'}</p></section>
  <h2>Vaccination history through issuance</h2><table><thead><tr><th>Vaccination</th><th>Brand / lot</th><th>Administered</th><th>Recorded valid through</th><th>Dose / administered by</th></tr></thead><tbody>${vaccineRows(vaccinations)}</tbody></table>
  <section class="signature"><div><strong>Veterinarian</strong><p>${display(issuer.name)}<br>PRC License No.: ${display(issuer.prcLicenseNumber)}<br>PTR No.: ${display(issuer.ptrNumber)}</p><div class="signature-line">Signature</div></div><figure class="certificate-qr">${qr}</figure></section>
  <footer><strong>${display(clinic.name)}</strong><br>Address: ${display(clinic.address)} · Phone: ${display(clinic.phone)} · Email: ${display(clinic.email)}<p>Validity dates above are the recorded vaccination next-dose dates, not inventory batch expiry dates. This clinic-issued document records vaccination evidence and issuer review for the stated journey.</p></footer></article></body></html>`
}

export async function printTravelCertificate(certificate) {
  certificate = await withTravelCertificateQr(certificate)
  const frame = document.createElement('iframe')
  frame.title = 'Travel certificate print'
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:1100px;border:0'
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { frame.remove(); reject(new Error('Certificate preparation timed out. Please retry printing.')) }, 15000)
      frame.onload = async () => {
        try {
          await frame.contentDocument.fonts.ready
          await Promise.all([...frame.contentDocument.images].map((image) => image.decode()))
          clearTimeout(timeout)
          frame.contentWindow.addEventListener('afterprint', () => frame.remove(), { once: true })
          frame.contentWindow.focus(); frame.contentWindow.print(); resolve()
        } catch (error) { clearTimeout(timeout); reject(error) }
      }
      frame.srcdoc = travelCertificateHtml(certificate)
      document.body.appendChild(frame)
    })
  } catch (error) { frame.remove(); throw error }
}
