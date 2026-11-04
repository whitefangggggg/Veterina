import { describe, expect, it } from 'vitest'
import { clinicRegistrationUrl, normalizeVeterinaCode, veterinaCodeFromQr } from './clinicAccess'
const code = 'VET-1234567890ABCDEF1234'
describe('clinic registration codes', () => {
  it('normalizes case and separators and rejects malformed codes', () => {
    expect(normalizeVeterinaCode(' vet-1234 5678-90ab-cdef-1234 ')).toBe(code)
    for (const value of ['', 'owner', code + '0', code + '<']) expect(normalizeVeterinaCode(value)).toBe('')
  })
  it('prefills only same-site registration URLs and never follows scanned redirects', () => {
    const origin = 'https://clinic.example'
    const url = clinicRegistrationUrl(code, origin)
    expect(veterinaCodeFromQr(url, origin)).toBe(code)
    expect(veterinaCodeFromQr(code, origin)).toBe(code)
    expect(veterinaCodeFromQr(url.replace('clinic.example','other.example'), origin)).toBe('')
    expect(veterinaCodeFromQr(`https://clinic.example/sign-in?code=${code}`, origin)).toBe('')
    expect(veterinaCodeFromQr('javascript:alert(1)', origin)).toBe('')
  })
})
