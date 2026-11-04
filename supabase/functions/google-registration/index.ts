import { body, checked, createClient, failure, headers, publicKey, url } from '../_shared/http.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  try {
    const authorization = req.headers.get('Authorization') || '';
    if (!authorization.startsWith('Bearer ')) throw new Error('UNAUTHENTICATED');
    const client = createClient(url, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.auth.getUser(authorization.slice(7));
    if (error || !data.user) throw new Error('UNAUTHENTICATED');
    const input = await body(req);
    if (!input || !['owner', 'staff'].includes(input.accountType)
      || typeof input.fullName !== 'string' || input.fullName.trim().length < 1 || input.fullName.length > 120) {
      return new Response(JSON.stringify({ error: 'Enter your full name and choose Owner or Staff.' }), { status: 400, headers });
    }
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
    const registration = checked(await admin.rpc('complete_google_registration', {
      p_actor: data.user.id,
      p_registration: {
        fullName: input.fullName.trim(), accountType: input.accountType,
        clinicName: typeof input.clinicName === 'string' ? input.clinicName : '',
        veterinaCode: typeof input.veterinaCode === 'string' ? input.veterinaCode : '',
      },
    }));
    return new Response(JSON.stringify(registration), { headers: { ...headers, 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = typeof error === 'object' && error && 'message' in error ? String(error.message) : '';
    if (message.startsWith('INVALID_VETERINA_CODE:') || message.startsWith('VALIDATION_FAILED:')) {
      return new Response(JSON.stringify({ error: message.slice(message.indexOf(':') + 1).trim() }), { status: 400, headers: { ...headers, 'Cache-Control': 'no-store' } });
    }
    const response = failure(error);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
});
