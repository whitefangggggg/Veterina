import { describe, expect, it } from 'vitest'
import { certificateVerificationUrl, withTravelCertificateQr } from './travelCertificateSharing'
import { travelCertificateHtml } from './travelCertificates'

const token = 'ab'.repeat(32)
describe('travel certificate sharing', () => {
  it('uses a random capability in the fragment without putting patient details in the URL', () => {
    const url = new URL(certificateVerificationUrl(token, 'https://clinic.example'))
    expect(url.pathname).toBe('/travel-certificate')
    expect(url.search).toBe('')
    expect(url.hash).toBe(`#${token}`)
    for (const invalid of ['', 'TC-2026-000001', 'abc', 'g'.repeat(64)]) expect(certificateVerificationUrl(invalid, 'https://clinic.example')).toBe('')
    for (const invalid of ['javascript:alert(1)', 'file:///tmp/', 'not a URL', 'https://user:password@clinic.example']) expect(certificateVerificationUrl(token, invalid)).toBe('')
  })
  it('generates a real PNG QR for saved certificates and leaves unissued previews without one', async () => {
    const certificate = { public_token: token, status: 'issued' }
    const prepared = await withTravelCertificateQr(certificate, 'https://clinic.example')
    expect(prepared.qrDataUrl).toMatch(/^data:image\/png;base64,iVBOR/)
    expect(prepared.verificationUrl).toBe(`https://clinic.example/travel-certificate#${token}`)
    expect(certificate.qrDataUrl).toBeUndefined()
    expect(await withTravelCertificateQr({ ...certificate, status: 'preview' }, 'https://clinic.example')).not.toHaveProperty('qrDataUrl')
  })
  it('prints the Veterinarian label, saved credentials and QR without substituting an account role', async () => {
    const certificate = await withTravelCertificateQr({ public_token: token, status: 'issued', snapshot: {
      pet: {}, owner: {}, clinic: {}, journey: {}, issuer: { name: 'Doctor', title: 'Clinical staff', prcLicenseNumber: '0012345' }, vaccinations: [],
    } }, 'https://clinic.example')
    const html = travelCertificateHtml(certificate)
    expect(html).toContain('<strong>Veterinarian</strong>')
    expect(html).toContain('0012345')
    expect(html).toContain('Scan to view this travel certificate')
    expect(html).not.toContain('Clinical staff')
    expect(html).not.toContain('authorized personnel')
  })
})
