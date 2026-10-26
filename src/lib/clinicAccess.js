export function normalizeVeterinaCode(value) {
  const normalized = String(value || '').toUpperCase().replace(/[\s-]/g, '')
  return /^VET[0-9A-F]{20}$/.test(normalized) ? `VET-${normalized.slice(3)}` : ''
}

export function clinicRegistrationUrl(code, origin) {
  const normalized = normalizeVeterinaCode(code)
  if (!normalized) throw new Error('A valid Veterina Code is required.')
  const url = new URL('/create-account', origin)
  url.searchParams.set('code', normalized)
  return url.href
}

export function veterinaCodeFromQr(value, origin) {
  const raw = normalizeVeterinaCode(value)
  if (raw) return raw
  try {
    const url = new URL(value)
    if (url.origin !== new URL(origin).origin || url.pathname !== '/create-account') return ''
    return normalizeVeterinaCode(url.searchParams.get('code'))
  } catch { return '' }
}
