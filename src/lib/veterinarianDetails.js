import { isClinicDate } from './dailyWorkflow'

export const isCertificateVeterinarian = (profile) => Boolean(profile?.is_active && profile?.is_veterinarian)

export function veterinarianLicenseWarnings(profile, today) {
  if (!profile) return []
  const warnings = []
  if (!profile.prc_license_number?.trim()) warnings.push('PRC license number is not recorded.')
  if (!isClinicDate(profile.license_expires_on)) warnings.push('License expiry date is not recorded.')
  else if (profile.license_expires_on < today) warnings.push('The recorded license has expired.')
  return warnings
}
