// Only for browser suites that intercept the Supabase API. This token has no
// cryptographic signature and cannot authenticate against a real Supabase server.
export function mockAccessToken(userId) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const header = { alg: 'HS256' }
  const payload = { sub: userId, role: 'authenticated', exp: 2000000000 }
  return [encode(header), encode(payload), 'test'].join('.')
}
