const clinicPath = /^\/(dashboard|queue|patients|appointments|reminders|inventory|suppliers|reports|settings|knowledge)(\/|$)/

// Only return to known clinic routes. Reject protocol-relative and encoded URLs.
export function safeReturnTo(value) {
  if (typeof value !== 'string' || /[\\\s]|\p{Cc}/u.test(value)) return '/dashboard'
  try {
    const url = new URL(value, 'https://veterina.invalid')
    if (!value.startsWith('/') || url.origin !== 'https://veterina.invalid') return '/dashboard'
    if (!clinicPath.test(url.pathname) || /%|\/\//.test(url.pathname)) return '/dashboard'
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return '/dashboard'
  }
}

export function getAccessState({ loading, error, user, profile }) {
  if (loading) return 'loading'
  if (error) return 'error'
  if (!user) return 'signed-out'
  if (profile?.id === user.id && profile.is_active === true && ['owner', 'clinical_staff'].includes(profile.role)) return 'approved'
  return 'pending'
}

export function authErrorMessage(error) {
  if (error?.name === 'AuthSessionMissingError') return 'Open the password reset link from your email, or request a new link.'
  if (['AuthImplicitGrantRedirectError', 'AuthPKCEGrantCodeExchangeError'].includes(error?.name)) return 'This password reset link is invalid or has expired. Please request a new link.'
  switch (error?.code) {
    case 'invalid_credentials': return 'The email or password is incorrect. Please try again.'
    case 'email_not_confirmed': return 'Please confirm your email before signing in.'
    case 'user_already_exists': return 'An account with this email already exists. Please sign in.'
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit': return 'Too many attempts. Please wait a few minutes and try again.'
    case 'signup_disabled': return 'Account registration is currently unavailable. Please contact your clinic administrator.'
    case 'otp_expired':
    case 'flow_state_expired':
    case 'flow_state_not_found':
    case 'bad_code_verifier': return 'This password reset link is invalid or has expired. Please request a new link.'
    case 'session_not_found':
    case 'refresh_token_not_found':
    case 'refresh_token_already_used': return 'Your session has expired. Please request a new password reset link.'
    case 'same_password': return 'Choose a password different from your current password.'
    case 'weak_password': return 'Choose a stronger password with at least 8 characters. Follow any additional requirements from your clinic.'
    case 'reauthentication_needed':
    case 'reauthentication_not_valid': return 'Please request a new password reset link to verify your identity before changing your password.'
    case 'user_banned': return 'This account is unavailable. Please contact your clinic administrator.'
    default: return error?.message || 'Unable to connect. Please try again.'
  }
}
