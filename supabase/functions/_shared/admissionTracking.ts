import { boundedBytes } from './petPhotos.ts';
import { clinicalSections, type ClinicalCursor } from './admissionTrackingCursor.ts';

export const trackingHeaders = {
  'Content-Type': 'application/json', 'Cache-Control': 'no-store, max-age=0',
  'Pragma': 'no-cache', 'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
  'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Hash the caller address with a server secret. The database never receives IPs.
export async function trackingClientHash(address: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(address));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

export function admissionTrackingHandler(deps: {
  lookup: (token: string, clientHash: string, page?: { section: string; cursor: ClinicalCursor | null }) => Promise<Record<string, unknown> | null>;
  clientHash: (req: Request) => Promise<string>;
  origin: string;
  cursors?: { seal: (cursor: ClinicalCursor, token: string, section: string) => Promise<string>; open: (cursor: string, token: string, section: string) => Promise<ClinicalCursor | null> };
}) {
  return async (req: Request): Promise<Response> => {
    const headers = { ...trackingHeaders, 'Access-Control-Allow-Origin': deps.origin };
    const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
    if (req.method === 'OPTIONS') return new Response(null, { headers });
    if (req.method !== 'POST') return reply({ error: 'METHOD_NOT_ALLOWED' }, 405);
    let token = '';
    let page: { section: string; cursor: ClinicalCursor | null } | undefined;
    try {
      const body = JSON.parse(new TextDecoder().decode(await boundedBytes(req.body, 2048)));
      if (typeof body?.token === 'string' && /^[A-Za-z0-9]{13}$/.test(body.token)) token = body.token;
      if (body?.section !== undefined) {
        if (!clinicalSections.includes(body.section)) token = '';
        else {
          let cursor: ClinicalCursor | null = null;
          if (body.cursor !== undefined) {
            cursor = typeof body.cursor === 'string' && deps.cursors ? await deps.cursors.open(body.cursor, token, body.section) : null;
            if (!cursor) token = '';
          }
          page = { section: body.section, cursor };
        }
      } else if (body?.cursor !== undefined) token = '';
    } catch { /* Invalid input still consumes a lookup allowance. */ }
    try {
      const hash = await deps.clientHash(req);
      const result = page ? await deps.lookup(token, hash, page) : await deps.lookup(token, hash);
      if (result?.limited) return new Response(JSON.stringify({ error: 'RATE_LIMITED' }), { status: 429, headers: { ...headers, 'Retry-After': '60' } });
      if (result) {
        const protectPage = async (value: unknown, section: string) => {
          const current = value as { items: unknown[]; next: ClinicalCursor | null };
          if (!current || !Array.isArray(current.items) || !deps.cursors) throw new Error('Invalid clinical page');
          return { items: current.items, cursor: current.next ? await deps.cursors.seal(current.next, token, section) : null };
        };
        if (result.clinical) {
          const clinical: Record<string, unknown> = {};
          for (const section of clinicalSections) clinical[section] = await protectPage((result.clinical as Record<string, unknown>)[section], section);
          result.clinical = clinical;
        }
        if (result.section) result.page = await protectPage(result.page, String(result.section));
      }
      return result ? reply(result) : reply({ error: 'NOT_AVAILABLE' }, 404);
    } catch {
      // Never log the request, capability, database error, or response contents.
      return reply({ error: 'TEMPORARILY_UNAVAILABLE' }, 503);
    }
  };
}
