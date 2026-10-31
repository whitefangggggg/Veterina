import { describe, expect, it } from 'vitest'
import { isClinicLogoDataUrl, MAX_LOGO_FILE_BYTES, prepareClinicLogo } from './clinicLogo'

describe('clinic logo validation', () => {
  it('allows only bounded embedded PNGs in exported documents', () => {
    expect(isClinicLogoDataUrl('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==')).toBe(true)
    for (const value of [null, '', 'https://example.org/logo.png', 'javascript:alert(1)', 'data:image/svg+xml,<svg onload="alert(1)">', 'data:image/png;base64,iVBORw0KGgo" onerror="alert(1)', 'data:image/png;base64,iVBORw0KGgo' + 'A'.repeat(400_000)]) {
      expect(isClinicLogoDataUrl(value)).toBe(false)
    }
  })

  it('rejects empty, oversized and disguised files before decoding', async () => {
    await expect(prepareClinicLogo(new Blob([]))).rejects.toThrow('PNG, JPEG or WebP')
    await expect(prepareClinicLogo({ size: MAX_LOGO_FILE_BYTES + 1 })).rejects.toThrow('5 MB')
    await expect(prepareClinicLogo(new Blob(['<svg onload="alert(1)"></svg>'], { type: 'image/png' }))).rejects.toThrow('PNG, JPEG or WebP')
  })
})
