import { describe, expect, it } from 'vitest'
import { clinicThemeStyle, initialClinicSetup, validateClinicSetup } from './clinicPersonalization'

describe('clinic personalization', () => {
  const valid = { ...initialClinicSetup({ clinic_name: 'Paws clinic' }), address: '123 Clinic Street', phone: '09171234567' }
  it('restores saved settings, opening hours and the setup step', () => {
    expect(initialClinicSetup({ clinic_name: 'Paws', onboarding_step: 2, brand_color: '#72549a', logo_data_url: 'prepared-image', business_hours: { mon: { closed: true } }, reminder_lead_days: 0 }))
      .toMatchObject({ clinicName: 'Paws', step: 2, brandColor: '#72549a', logoDataUrl: 'prepared-image', businessHours: { mon: { closed: true } }, reminderLeadDays: 0 })
  })
  it('requires contact details at completion but allows optional branding and hours', () => {
    expect(validateClinicSetup(valid, 3)).toBe('')
    expect(validateClinicSetup({ ...valid, address: ' ' }, 3)).toContain('address')
    expect(validateClinicSetup({ ...valid, phone: '' }, 0)).toContain('phone')
    expect(validateClinicSetup({ ...valid, website: 'javascript:alert(1)' }, 0)).toContain('website')
  })
  it('validates clinic timezones, reminder days and same-day opening hours', () => {
    expect(validateClinicSetup({ ...valid, timezone: 'invalid/timezone' }, 2)).toContain('timezone')
    expect(validateClinicSetup({ ...valid, reminderLeadDays: -1 }, 2)).toContain('lead days')
    expect(validateClinicSetup({ ...valid, reminderLeadDays: 366 }, 2)).toContain('lead days')
    expect(validateClinicSetup({ ...valid, businessHours: { mon: { closed: false, open: '17:00', close: '09:00' } } }, 2)).toContain('Monday')
    expect(validateClinicSetup({ ...valid, businessHours: { mon: { closed: true } } }, 2)).toBe('')
  })
  it('limits theme styling to the supported palettes', () => {
    expect(clinicThemeStyle('#72549a')['--brand']).toBe('#72549a')
    expect(clinicThemeStyle('url(https://invalid.example)')['--brand']).toBe('#2a6f62')
  })
})
