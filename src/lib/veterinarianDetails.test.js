import { describe, expect, it } from 'vitest'
import { isCertificateVeterinarian, veterinarianLicenseWarnings } from './veterinarianDetails'

describe('veterinarian profiles', () => {
  it('requires explicit designation and active status independently of account permissions', () => {
    for (const role of ['owner', 'clinical_staff']) {
      expect(isCertificateVeterinarian({ role, is_active: true, is_veterinarian: true })).toBe(true)
      expect(isCertificateVeterinarian({ role, is_active: true, is_veterinarian: false, prc_license_number: '123' })).toBe(false)
      expect(isCertificateVeterinarian({ role, is_active: false, is_veterinarian: true })).toBe(false)
    }
    expect(isCertificateVeterinarian(null)).toBe(false)
  })
  it('warns for unknown and expired licenses but accepts same-day expiry using the clinic date', () => {
    expect(veterinarianLicenseWarnings(null, '2026-11-07')).toEqual([])
    expect(veterinarianLicenseWarnings({}, '2026-11-07')).toEqual(['PRC license number is not recorded.', 'License expiry date is not recorded.'])
    expect(veterinarianLicenseWarnings({ prc_license_number: '00123', license_expires_on: '2026-11-07' }, '2026-11-07')).toEqual([])
    expect(veterinarianLicenseWarnings({ prc_license_number: '00123', license_expires_on: '2026-11-06' }, '2026-11-07')).toEqual(['The recorded license has expired.'])
    expect(veterinarianLicenseWarnings({ prc_license_number: ' ', license_expires_on: '2026-02-30' }, '2026-11-07')).toHaveLength(2)
  })
})
