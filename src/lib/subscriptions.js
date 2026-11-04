export function subscriptionError(error) {
  const code = error?.message || error?.code || 'REQUEST_FAILED'
  const messages = {
    ACTIVATION_CODE_INVALID: 'That activation code was not found. Check the code with your administrator.',
    ACTIVATION_CODE_EXPIRED: 'This code’s activation window has expired. Ask your administrator for a new code.',
    ACTIVATION_CODE_REVOKED: 'This code has been revoked. Ask your administrator for a replacement.',
    ACTIVATION_CODE_USED: 'Your clinic has already used this code. Renew with a different code.',
    ACTIVATION_CODE_REQUIRED: 'Enter a subscription activation code to create your clinic.',
    REQUEST_CHANGED: 'The request changed during a retry. Submit the updated details again.',
    FORBIDDEN: 'Your account does not have permission for this action.',
    UNAUTHENTICATED: 'Please sign in again before continuing.',
    VALIDATION_FAILED: 'Check the entered details and use a duration between 1 and 3,650 days.',
    NOT_FOUND: 'This clinic or code is no longer available. Refresh and try again.',
    REQUEST_FAILED: 'The request could not be completed. Please try again.',
  }
  return messages[code] || code
}

export async function invokeSubscription(client, name, body) {
  const { data, error } = await client.functions.invoke(name, { body })
  if (error) {
    const details = error.context instanceof Response ? await error.context.json().catch(() => null) : null
    throw new Error(subscriptionError({ message: details?.error || error.message }))
  }
  return data
}

export function remainingTime(expiresAt, now = Date.now()) {
  if (!expiresAt) return 'Not activated'
  const minutes = Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 60000))
  if (!Number.isFinite(minutes)) return 'Unavailable'
  if (!minutes) return 'Expired'
  const days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60)
  return `${days}d ${hours}h ${minutes % 60}m`
}

export function subscriptionDate(value, timezone = 'Asia/Manila') {
  if (!value) return 'Not activated'
  return new Intl.DateTimeFormat('en', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}
