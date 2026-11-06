import { describe, expect, it } from 'vitest'
import { certificateAge, completedTravelVaccinations, travelCertificateErrors, travelCertificateHtml, travelCertificatePreview } from './travelCertificates'

const today = '2026-11-06'
const pet = { id: 'pet', ownerId: 'owner', name: 'Ming <Cat>', status: 'Active', species: 'Cat', breed: '', birthDate: '2024-11-07', birthDateEstimated: true }
const owner = { fullName: 'José & Ana', isActive: true }
const issuer = { id: 'staff', full_name: 'Dr. Máya', is_active: true, prc_license_number: 'PRC-123' }
const vaccination = { id: 'rabies', petId: 'pet', vaccine: 'Bakuna', brand: 'Brand', lotNumber: 'LOT-1', administeredAt: '2026-10-01', nextDueAt: '2027-10-01', careStatus: 'Recorded' }
const context = { pet, owner, issuer, vaccination, travelDate: '2026-11-07', today }
const preview = () => travelCertificatePreview({ ...context, vaccinations: [vaccination], rabiesVaccinationId: 'rabies', destination: 'Cebu <Port>', clinic: { clinic_name: 'Clinic', address: 'Address' } })

describe('travel certificates', () => {
  it('accepts the valid-through date inclusively without treating a brand as a vaccine classification', () => {
    expect(travelCertificateErrors({ ...context, travelDate: vaccination.nextDueAt })).toEqual([])
    expect(travelCertificateErrors({ ...context, travelDate: '2027-10-02' })).not.toEqual([])
    expect(travelCertificateErrors({ ...context, travelDate: today, vaccination: { ...vaccination, nextDueAt: today } })).toEqual([])
  })
  it('rejects incomplete, expired, future, other-pet and non-completed vaccination evidence', () => {
    for (const change of [{ nextDueAt: null }, { nextDueAt: '2026-11-05' }, { administeredAt: '2026-11-07' }, { petId: 'other' }, { careStatus: 'Waiting' }, { careStatus: 'In progress' }, { careStatus: 'Cancelled' }]) {
      expect(travelCertificateErrors({ ...context, vaccination: { ...vaccination, ...change } })).not.toEqual([])
    }
    expect(travelCertificateErrors({ ...context, vaccination: null })).not.toEqual([])
  })
  it('requires an active owner, patient and issuer and a valid nonpast journey date', () => {
    for (const change of [{ pet: { ...pet, status: 'Deceased' } }, { owner: { ...owner, isActive: false } }, { issuer: { ...issuer, is_active: false } }, { travelDate: '2026-02-30' }, { travelDate: '2026-11-05' }]) expect(travelCertificateErrors({ ...context, ...change })).not.toEqual([])
  })
  it('includes completed historical vaccinations regardless of archived product status, but no pending, future or other-pet records', () => {
    expect(completedTravelVaccinations([vaccination, { ...vaccination, id: 'completed', careStatus: 'Completed' }, { ...vaccination, id: 'pending', careStatus: 'Waiting' }, { ...vaccination, petId: 'other' }, { ...vaccination, administeredAt: '2026-11-07' }], 'pet', today).map((row) => row.id)).toEqual(['rabies', 'completed'])
  })
  it('calculates age at issuance with estimated and unknown dates', () => {
    expect(certificateAge(pet.birthDate, today, true)).toBe('1 year, 11 months (estimated)')
    expect(certificateAge('2026-11-01', today)).toBe('Under 1 month')
    expect(certificateAge(null, today)).toBe('Not recorded')
    expect(certificateAge('2026-12-01', today)).toBe('Not recorded')
  })
  it('renders a labelled unissued preview without allocating a reference and escapes all record text', () => {
    const html = travelCertificateHtml(preview())
    for (const text of ['UNISSUED PREVIEW', 'Ming &lt;Cat&gt;', 'José &amp; Ana', 'Cebu &lt;Port&gt;', 'PRC-123', 'Not recorded', '1 year, 11 months (estimated)', 'table-header-group', 'Signature']) expect(html).toContain(text)
    expect(html).not.toContain('Ming <Cat>')
    expect(html).not.toContain('TC-2026-')
  })
  it('marks void documents prominently and uses saved information after live source changes', () => {
    const saved = { ...preview(), reference_number: 'TC-2026-000001', status: 'void', void_reason: '<Incorrect destination>' }
    pet.name = 'Changed live name'
    const html = travelCertificateHtml(saved)
    expect(html).toContain('Ming &lt;Cat&gt;')
    expect(html).not.toContain('Changed live name')
    expect(html).toContain('VOID CERTIFICATE')
    expect(html).toContain('&lt;Incorrect destination&gt;')
    pet.name = 'Ming <Cat>'
  })
  it('does not claim validity on a blocked unissued preview', () => {
    const blocked = travelCertificatePreview({ ...context, vaccinations: [], rabiesVaccinationId: '', destination: 'Cebu', clinic: {} })
    expect(travelCertificateHtml(blocked)).toContain('Vaccination evidence requires review before issuance.')
  })
  it('embeds only supported patient image bytes and preserves the photo on saved reprints', () => {
    const photo = 'data:image/png;base64,iVBORw0KGgo='
    const certificate = travelCertificatePreview({ ...context, vaccinations: [vaccination], rabiesVaccinationId: 'rabies', destination: 'Cebu', clinic: {}, patientPhotoDataUrl: photo })
    expect(travelCertificateHtml(certificate)).toContain(`src="${photo}" alt="Patient photo: Ming &lt;Cat&gt;"`)
    certificate.status = 'issued'
    expect(travelCertificateHtml(certificate)).toContain(photo)
    for (const unsafe of ['https://example.org/pet.png', 'javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,abc" onerror="alert(1)']) {
      certificate.snapshot.pet.photoDataUrl = unsafe
      const html = travelCertificateHtml(certificate)
      expect(html).not.toContain(unsafe)
      expect(html).toContain('<span>Not recorded</span>')
    }
  })
})
