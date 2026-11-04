import { body, createClient, headers, publicKey, url } from './http.ts';

export async function subscriptionRequest(req: Request) {
  const authorization = req.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) throw new Error('UNAUTHENTICATED');
  const client = createClient(url, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.getUser(authorization.slice(7));
  if (error || !data.user || !data.user.email_confirmed_at) throw new Error('UNAUTHENTICATED');
  const input = await body(req);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('VALIDATION_FAILED');
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
  return { user: data.user, input, admin };
}

export function subscriptionResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, 'Cache-Control': 'no-store' } });
}

export function subscriptionFailure(error: unknown) {
  const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : 'REQUEST_FAILED';
  const known = ['UNAUTHENTICATED', 'FORBIDDEN', 'ACTIVATION_CODE_INVALID', 'ACTIVATION_CODE_REVOKED', 'ACTIVATION_CODE_EXPIRED', 'ACTIVATION_CODE_USED', 'ACTIVATION_CODE_REQUIRED', 'REQUEST_CHANGED', 'NOT_FOUND', 'VALIDATION_FAILED'];
  const code = known.find((value) => message.startsWith(value)) || 'REQUEST_FAILED';
  return subscriptionResponse({ error: code }, code === 'UNAUTHENTICATED' ? 401 : code === 'FORBIDDEN' ? 403 : 400);
}
