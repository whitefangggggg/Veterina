export const clinicThemes = [
  { name: 'Coastal green', color: '#2a6f62', dark: '#1d554b', soft: '#e6f2ee' },
  { name: 'Ocean blue', color: '#305b9a', dark: '#234575', soft: '#eaf0fa' },
  { name: 'Orchid', color: '#72549a', dark: '#573d7a', soft: '#f0ebf7' },
  { name: 'Rose', color: '#a04b67', dark: '#7d344c', soft: '#faedf1' },
  { name: 'Warm amber', color: '#966128', dark: '#73481b', soft: '#faf0e2' },
  { name: 'Forest', color: '#426b45', dark: '#305133', soft: '#edf4e9' },
]

export const clinicDays = [
  ['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'],
  ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday'],
]

export function clinicThemeStyle(color) {
  const theme = clinicThemes.find((entry) => entry.color === color) || clinicThemes[0]
  return { '--brand': theme.color, '--brand-dark': theme.dark, '--brand-soft': theme.soft }
}

export function initialClinicSetup(settings) {
  settings ||= {}
  return {
    clinicName: settings.clinic_name || '', address: settings.address || '', phone: settings.phone || '',
    email: settings.email || '', website: settings.website || '', tagline: settings.tagline || '',
    logoDataUrl: settings.logo_data_url || null, brandColor: settings.brand_color || clinicThemes[0].color,
    timezone: settings.timezone || 'Asia/Manila', reminderLeadDays: settings.reminder_lead_days ?? 3,
    businessHours: settings.business_hours || {}, step: settings.onboarding_step || 0,
  }
}

export function validateClinicSetup(values, step) {
  if (step === 0 || step === 3) {
    if (!values.clinicName.trim()) return 'Enter your clinic name.'
    if (!values.address.trim()) return 'Enter your clinic address.'
    if (!values.phone.trim()) return 'Enter your clinic phone number.'
    if (values.website && !/^https?:\/\/\S+$/i.test(values.website)) return 'Use a website address starting with https:// or http://.'
  }
  if (step === 2 || step === 3) {
    try { new Intl.DateTimeFormat('en', { timeZone: values.timezone }).format() }
    catch { return 'Choose a valid clinic timezone.' }
    if (!/^\d{1,3}$/.test(String(values.reminderLeadDays)) || Number(values.reminderLeadDays) > 365) return 'Reminder lead days must be between 0 and 365.'
    for (const [day, label] of clinicDays) {
      const hours = values.businessHours[day]
      if (hours && !hours.closed && (!hours.open || !hours.close || hours.open >= hours.close)) return `${label}: closing time must be after opening time.`
    }
  }
  return ''
}
