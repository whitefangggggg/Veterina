import { describe, expect, it } from 'vitest'
import { certificateAge, certificateIssueTime, completedTravelVaccinations, travelCertificateDetailErrors, travelCertificateErrors, travelCertificateHtml, travelCertificateOwnerDetails, travelCertificateOwnerErrors, travelCertificatePreview, travelCertificateWeight } from './travelCertificates'

const today = '2026-11-06'
const pet = { id: 'pet', ownerId: 'owner', name: 'Ming <Cat>', status: 'Active', species: 'Cat', breed: '', birthDate: '2024-11-07', birthDateEstimated: true }
const owner = { fullName: 'José & Ana', isActive: true }
const issuer = { id: 'staff', full_name: 'Dr. Máya', is_active: true, is_veterinarian: true, prc_license_number: 'PRC-123', tin_number: '736-954-286', license_expires_on: '2027-01-01' }
const vaccination = { id: 'rabies', petId: 'pet', vaccine: 'Bakuna', brand: 'Brand', lotNumber: 'LOT-1', administeredAt: '2026-10-01', nextDueAt: '2027-10-01', careStatus: 'Recorded' }
const context = { pet, owner, issuer, vaccination, travelDate: '2026-11-07', today }
const preview = () => travelCertificatePreview({ ...context, vaccinations: [vaccination], rabiesVaccinationId: 'rabies', destination: 'Cebu <Port>', clinic: { clinic_name: 'Clinic', address: 'Address' } })

describe('travel certificates', () => {
  it('copies the selected veterinarian TIN from settings and preserves issued values after profile edits', () => {
    const record = preview()
    expect(record.snapshot.issuer.tinNumber).toBe(issuer.tin_number)
    const other = travelCertificatePreview({ ...context, issuer: { ...issuer, tin_number: '000-123-456' }, vaccinations: [vaccination], destination: 'Cebu', veterinarianTin: 'Ignored caller override' })
    expect(other.snapshot.issuer.tinNumber).toBe('000-123-456')
    const missing = travelCertificatePreview({ ...context, issuer: { ...issuer, tin_number: null }, vaccinations: [vaccination], destination: 'Cebu', veterinarianTin: 'Ignored caller override' })
    expect(missing.snapshot.issuer.tinNumber).toBeNull()
    expect(travelCertificateHtml(missing)).toContain('TIN No.: Not recorded')
    const source = { ...issuer }
    const saved = travelCertificatePreview({ ...context, issuer: source, vaccinations: [vaccination], destination: 'Cebu' })
    source.tin_number = 'Updated profile TIN'
    expect(saved.snapshot.issuer.tinNumber).toBe('736-954-286')
  })
  it('requires all certificate owner fields and preserves local spelling and formatted contacts', () => {
    const details = { name: 'Ma. Niña <Abes>', address: 'Purok 2\nBarangay San José', contactNumber: '+63 926 121 3497' }
    expect(travelCertificateOwnerErrors(details)).toEqual([])
    for (const changes of [{ name: '' }, { address: ' \n ' }, { contactNumber: '' }, { name: 123 }, { address: null }, { name: 'a\nb' }, { contactNumber: 'a\tb' }, { name: 'x'.repeat(121) }, { address: 'x'.repeat(2001) }, { contactNumber: 'x'.repeat(65) }]) {
      expect(travelCertificateOwnerErrors({ ...details, ...changes })).not.toEqual([])
    }
    const original = { ...owner, address: 'Original address', phone: '09171234567' }
    const record = travelCertificatePreview({ ...context, owner: original, ownerDetails: details, vaccinations: [vaccination], rabiesVaccinationId: 'rabies', destination: 'Cebu', clinic: {} })
    expect(record.snapshot.owner).toEqual(details)
    expect(original).toEqual({ ...owner, address: 'Original address', phone: '09171234567' })
    expect(travelCertificateOwnerDetails(original)).toEqual({ name: owner.fullName, address: 'Original address', contactNumber: '09171234567' })
    details.name = 'Changed draft'
    original.address = 'Changed clinic address'
    const html = travelCertificateHtml(record)
    expect(html).toContain('Ma. Niña &lt;Abes&gt;')
    expect(html).toContain('Purok 2\nBarangay San José')
    expect(html).toContain('+63 926 121 3497')
    expect(html).not.toContain('Changed draft')
    expect(html).not.toContain('Changed clinic address')
  })
  it('uses version 4 to print license expiry and retains every earlier document layout', () => {
    const record = preview()
    expect(record.snapshot.version).toBe(4)
    expect(record.snapshot.issuer.licenseExpiresOn).toBe('2027-01-01')
    const html = travelCertificateHtml(record)
    for (const content of ['class="letterhead"', 'TO WHOM IT MAY CONCERN:', 'class="owner-details"', 'class="pet-description"', 'break-before:page', 'table-header-group', 'System reference', 'Signature above printed name']) expect(html).toContain(content)
    for (const version of [undefined, 1, 2]) {
      const legacy = travelCertificateHtml({ ...record, snapshot: { ...record.snapshot, version } })
      expect(legacy).toContain('class="patient-details"')
      expect(legacy).not.toContain('class="letterhead"')
      expect(legacy).not.toContain('TO WHOM IT MAY CONCERN:')
    }
    expect(html).not.toContain('I have examined')
    expect(html).not.toContain('free from evidence')
    expect(html).toContain('License Expiry Date: 1 January 2027')
    const version3 = travelCertificateHtml({ ...record, snapshot: { ...record.snapshot, version: 3 } })
    expect(version3).toContain('class="letterhead"')
    expect(version3).not.toContain('License Expiry Date:')
    expect(travelCertificateHtml({ ...record, snapshot: { ...record.snapshot, issuer: { ...record.snapshot.issuer, licenseExpiresOn: null } } })).toContain('License Expiry Date: Not recorded')
  })
  it('validates manual control numbers and keeps certificate, product and next-dose dates separate', () => {
    const details = { controlNumber: '00443', validUntil: '2026-11-11', vaccineExpirationDate: '2026-10-02', ...context }
    expect(travelCertificateDetailErrors(details)).toEqual([])
    for (const changes of [{ controlNumber: '' }, { controlNumber: 443 }, { controlNumber: 'a\nb' }, { controlNumber: 'x'.repeat(65) },
      { validUntil: '2026-11-06' }, { validUntil: '2028-01-01' }, { validUntil: '2026-02-30' }, { vaccineExpirationDate: '2026-09-30' }]) {
      expect(travelCertificateDetailErrors({ ...details, ...changes })).not.toEqual([])
    }
    expect(travelCertificateDetailErrors({ ...details, validUntil: vaccination.nextDueAt, travelDate: vaccination.nextDueAt })).toEqual([])
  })
  it('snapshots and escapes every supplied document detail, preserving leading zeroes and optional unknowns', () => {
    const record = travelCertificatePreview({ ...context, pet: { ...pet, color: 'Tri-Color', sex: 'Male', latestWeight: 7.5, microchip: null },
      owner: { ...owner, address: 'Sta. Cruz <Town>', phone: '0926 121 3497' }, controlNumber: '00443', validUntil: '2026-11-11', issuedTime: '11:17',
      vaccineExpirationDate: '2027-03-29', vaccinations: [vaccination], rabiesVaccinationId: 'rabies', destination: 'Cebu', clinic: {} })
    expect(record.snapshot.controlNumber).toBe('00443')
    expect(record.snapshot.vaccinations[0]).toMatchObject({ type: 'Anti-Rabies', vaccinated: true, expirationDate: '2027-03-29', validThrough: '2027-10-01' })
    const html = travelCertificateHtml(record)
    for (const text of ['00443', '11:17', '11 November 2026', 'Tri-Color', 'Male', '7.5 kg', 'Microchip number', 'Not recorded', 'Sta. Cruz &lt;Town&gt;', '0926 121 3497', '29 March 2027', '736-954-286', 'Vaccinated: Yes']) expect(html).toContain(text)
    expect(html).not.toContain('Sta. Cruz <Town>')
    record.snapshot.controlNumber = '<script>alert(1)</script>'
    record.snapshot.issuer.tinNumber = '<img src=x>'
    expect(travelCertificateHtml(record)).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(travelCertificateHtml(record)).not.toContain('<img src=x>')
  })
  it('uses clinic-local issuance time and excludes future care or future measurements from recorded weight', () => {
    expect(certificateIssueTime('Asia/Manila', new Date('2026-07-24T03:17:00Z'))).toBe('11:17')
    const visits = [{ petId: 'pet', visitedAt: '2026-07-01T01:00:00Z', weightKg: 7.5 },
      { petId: 'other', visitedAt: '2026-07-23T01:00:00Z', weightKg: 100 },
      { petId: 'pet', visitedAt: '2026-08-01T01:00:00Z', weightKg: 8 },
      { petId: 'pet', visitedAt: '2026-07-02T01:00:00Z', weightMeasuredAt: '2026-08-01T01:00:00Z', weightKg: 9 }]
    expect(travelCertificateWeight(pet, visits, new Date('2026-07-24T03:17:00Z'))).toBe(7.5)
    expect(travelCertificateWeight({ ...pet, baseline_weight: '4.5' }, [])).toBe(4.5)
    expect(travelCertificateWeight(pet, [])).toBeNull()
  })
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
  it('rejects undesignated certifiers but allows designated veterinarians with incomplete or expired credentials', () => {
    expect(travelCertificateErrors({ ...context, issuer: { ...issuer, is_veterinarian: false } })).not.toEqual([])
    expect(travelCertificateErrors({ ...context, issuer: { ...issuer, prc_license_number: null, license_expires_on: null } })).toEqual([])
    expect(travelCertificateErrors({ ...context, issuer: { ...issuer, license_expires_on: '2020-01-01' } })).toEqual([])
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
