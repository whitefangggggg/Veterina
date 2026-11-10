export const clinicalSections = ['activity', 'monitoring', 'tasks', 'resolvedTasks', 'orders', 'administrations'] as const;
export type ClinicalCursor = { at: string; id: string };
const encoder = new TextEncoder();
const base64url = (value: Uint8Array) => btoa(String.fromCharCode(...value)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

// Domain-separated encryption uses a provisioned server secret, never a browser key.
export function clinicalCursorCodec(secret: string, now = Date.now) {
  const key = crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey']).then(material =>
    crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('Veterina admission tracking'), info: encoder.encode('clinical cursor v1') }, material,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']));
  const context = async (token: string, section: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(`v1:${section}:${token}`)));
  return {
    async seal(cursor: ClinicalCursor, token: string, section: string) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = encoder.encode(JSON.stringify({ ...cursor, expires: now() + 15 * 60_000 }));
      const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: await context(token, section) }, await key, data));
      return base64url(new Uint8Array([...iv, ...encrypted]));
    },
    async open(cursor: string, token: string, section: string): Promise<ClinicalCursor | null> {
      try {
        if (cursor.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
        const bytes = Uint8Array.from(atob(cursor.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
        const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: await context(token, section) }, await key, bytes.slice(12));
        const value = JSON.parse(new TextDecoder().decode(decrypted));
        if (!Number.isFinite(value.expires) || value.expires <= now() || value.expires > now() + 15 * 60_000
          || typeof value.at !== 'string' || !Number.isFinite(Date.parse(value.at))
          || typeof value.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.id)) return null;
        return { at: value.at, id: value.id };
      } catch { return null; }
    },
  };
}
