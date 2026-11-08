import { describe, expect, it } from 'vitest'
import { emptyManualTravelVaccination, manualTravelVaccinationErrors, manualTravelVaccinationRecords } from './manualTravelVaccinations'
import { travelCertificateErrors, travelCertificatePreview, travelCertificateHtml } from './travelCertificates'

const today = '2026-11-07'
const vaccine = () => ({ ...emptyManualTravelVaccination(), vaccine: ' Rabies <label> ', lotNumber: ' MANUAL-01 ', administeredAt: '2026-10-01', nextDueAt: '2027-10-01', expirationDate: '2027-01-01' })

describe('manual certificate vaccination evidence', () => {
  it('requires name, lot and an administration date, but allows unknown optional details', () => {
    expect(manualTravelVaccinationErrors([vaccine()], today)).toEqual([])
    expect(manualTravelVaccinationErrors([{ ...vaccine(), lotNumber: '  ' }], today).join()).toContain('lot number')
    expect(manualTravelVaccinationErrors([{ ...vaccine(), administeredAt: '2026-11-08' }], today).join()).toContain('administration date')
    expect(manualTravelVaccinationErrors([{ ...vaccine(), administeredAt: '2026-02-30' }], today).join()).toContain('administration date')
  })
  it('rejects conflicting identifiers, excessive rows, controls and invalid date ranges', () => {
    const item = vaccine()
    expect(manualTravelVaccinationErrors([item, item], today).join()).toContain('duplicate')
    expect(manualTravelVaccinationErrors(Array.from({ length: 51 }, vaccine), today).join()).toContain('50')
    expect(manualTravelVaccinationErrors([{ ...item, lotNumber: 'x'.repeat(201) }], today).join()).toContain('lot number')
    expect(manualTravelVaccinationErrors([{ ...item, brand: 'a\nb' }], today).join()).toContain('brand')
    expect(manualTravelVaccinationErrors([{ ...item, nextDueAt: item.administeredAt }], today).join()).toContain('next due')
    expect(manualTravelVaccinationErrors([{ ...item, expirationDate: '2026-09-01' }], today).join()).toContain('expiration')
  })
  it('uses the same evidence for validation and escaped document previews', () => {
    const pet = { id: 'pet', name: 'Ming', status: 'Active' }
    const owner = { fullName: 'Owner', isActive: true }
    const issuer = { full_name: 'Doctor', is_active: true, is_veterinarian: true }
    const vaccinations = manualTravelVaccinationRecords([vaccine()], pet.id)
    expect(travelCertificateErrors({ pet, owner, issuer, vaccination: vaccinations[0], travelDate: today, today })).toEqual([])
    const preview = travelCertificatePreview({ pet, owner, issuer, vaccinations: [...vaccinations, ...vaccinations], rabiesVaccinationId: vaccinations[0].id, today, travelDate: today, destination: 'Cebu', clinic: {} })
    expect(preview.snapshot.vaccinations).toHaveLength(1)
    expect(preview.snapshot.vaccinations[0]).toMatchObject({ name: 'Rabies <label>', lotNumber: 'MANUAL-01' })
    expect(travelCertificateHtml(preview)).toContain('Rabies &lt;label&gt;')
    expect(travelCertificateHtml(preview)).toContain('MANUAL-01')
    expect(travelCertificateHtml(preview)).not.toContain('Rabies <label>')
  })
})
