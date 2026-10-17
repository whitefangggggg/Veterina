export function validateNewPassword(password, confirmation) {
  if (password.length < 8) return 'Use at least 8 characters for your new password.'
  if (password !== confirmation) return 'Your passwords do not match.'
  return ''
}
