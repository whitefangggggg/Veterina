import { describe, expect, it } from 'vitest'
import { prescriptionHtml, prescriptionMedications } from './prescriptions'

const medications = [
  { medicationName: 'Medicine A', dose: 'Recorded dose A', frequency: 'Recorded frequency A', duration: 'Recorded duration A', instructions: 'First instructions' },
  { medicationName: 'Medicine B', dose: 'Recorded dose B', frequency: 'Recorded frequency B', duration: 'Recorded duration B', instructions: '<script>unsafe</script>\nWith food & water' },
]

describe('prescriptions', () => {
  it('retains historical single-medication records', () => {
    expect(prescriptionMedications({ medication_name: 'Legacy', dose: 'Dose', frequency: 'Frequency', instructions: 'Notes' })).toEqual([{ medicationName: 'Legacy', dose: 'Dose', frequency: 'Frequency', duration: '', instructions: 'Notes' }])
  })

  it('prints every medication and the correct prescriber using clinic settings, escaping all text', () => {
    const html = prescriptionHtml({
      prescription: { medications, prescribed_by: 'vet', prescribed_by_name: 'Recorded clinician', prescribed_at: '2026-10-17T17:00:00Z' },
      pet: { name: 'Mochi <Cat>', birthDate: '2024-10-18', sex: 'Male', species: 'Cat' },
      visit: { diagnosis: 'Recorded diagnosis', weightKg: 0 },
      clinic: { clinic_name: 'Clinic & Co', address: 'Clinic address', phone: 'Clinic phone', email: 'clinic@example.org', timezone: 'Asia/Singapore' },
      profiles: [{ id: 'owner', full_name: 'Other owner' }, { id: 'vet', full_name: 'Renamed clinician', prc_license_number: 'PRC-1', ptr_number: 'PTR-2' }],
      owner: { fullName: 'Pet owner' },
    })
    for (const value of ['Medicine A', 'Medicine B', 'Recorded duration B', 'Recorded frequency A', 'First instructions', 'Mochi &lt;Cat&gt;', 'Clinic &amp; Co', 'Clinic address', 'Clinic phone', 'clinic@example.org', 'Recorded clinician', 'PRC-1', 'PTR-2', '2026-10-18', '2 yrs', '0 kg', 'Pet owner', 'Recorded diagnosis', 'Signature', '&lt;script&gt;unsafe&lt;/script&gt;']) expect(html).toContain(value)
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('Other owner')
    expect(html.indexOf('Medicine A')).toBeLessThan(html.indexOf('Medicine B'))
  })
})
