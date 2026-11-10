import { checked, createClient, url } from '../_shared/http.ts';
import { admissionTrackingHandler, trackingClientHash } from '../_shared/admissionTracking.ts';
import { clinicalCursorCodec } from '../_shared/admissionTrackingCursor.ts';

const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
Deno.serve(admissionTrackingHandler({
  origin: Deno.env.get('APP_ORIGIN') || '*',
  cursors: clinicalCursorCodec(secret),
  // The project-wide bucket also caps requests when proxies hide client IPs or
  // callers spoof forwarding headers. Never use a caller address for access control.
  clientHash: req => trackingClientHash((req.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim().slice(0, 128), secret),
  lookup: async (token, hash, page) => checked(await admin.rpc('lookup_public_admission_content', {
    p_token: token, p_client_hash: hash, p_section: page?.section ?? null, p_cursor: page?.cursor ?? null,
  })),
}));
