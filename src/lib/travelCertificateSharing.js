export function certificateVerificationUrl(token, origin = globalThis.location?.origin) {
  if (!/^[a-f0-9]{64}$/.test(token || '') || !origin) return ''
  try {
    const url = new URL('/travel-certificate', origin)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return ''
    // Keep the capability token out of server logs and HTTP referrers.
    url.hash = token
    return url.href
  } catch { return '' }
}

export async function withTravelCertificateQr(certificate, origin) {
  const verificationUrl = certificateVerificationUrl(certificate.public_token, origin)
  if (!verificationUrl || certificate.status === 'preview') return certificate
  if (certificate.verificationUrl === verificationUrl && certificate.qrDataUrl) return certificate
  const { default: QRCode } = await import('qrcode')
  const qrDataUrl = await QRCode.toDataURL(verificationUrl, { width: 240, margin: 3, errorCorrectionLevel: 'M' })
  return { ...certificate, verificationUrl, qrDataUrl }
}
