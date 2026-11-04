export const MAX_PHOTO_BYTES = 5_000_000;
export type CloudinaryConfig = { cloud: string; key: string; secret: string; preset: string };
export type PhotoAsset = { public_id: string; asset_id: string; version: number; format: string; bytes: number; type: string; resource_type: string };

export class PhotoProviderFailure extends Error {
  constructor(public readonly reason:string, public readonly status?:number) { super('PHOTO_PROVIDER_FAILED'); }
}
export async function providerFailure(response:Response):Promise<PhotoProviderFailure> {
  // Provider messages may contain credentials or signed parameters. Expose only
  // a fixed diagnostic category to the authenticated maintenance worker.
  const text=await response.text();
  let message=text;
  try { const body=JSON.parse(text);message=String(body?.error?.message||body?.error||body?.message||''); } catch { /* Only classify non-JSON responses; never return their text. */ }
  message+=' '+(response.headers.get('x-cld-error')||'');
  const reason=/timestamp|stale request|reported time/i.test(message)?'TIMESTAMP_REJECTED':/signature/i.test(message)?'INVALID_SIGNATURE':/permission|denied|not allowed|forbidden|unauthorized|not permitted/i.test(message)?'ACCESS_DENIED':/api.?key/i.test(message)?'INVALID_API_KEY':/cloud.?name|unknown cloud/i.test(message)?'INVALID_CLOUD_NAME':/preset/i.test(message)?'INVALID_UPLOAD_PRESET':/transformation|angle/i.test(message)?'INVALID_TRANSFORMATION':/image|file format/i.test(message)?'INVALID_IMAGE':/disabled|suspended/i.test(message)?'ACCOUNT_DISABLED':/blocked|cloudflare/i.test(message)?'REQUEST_BLOCKED':/plan|limit|quota/i.test(message)?'ACCOUNT_LIMIT':/type/i.test(message)?'INVALID_DELIVERY_TYPE':'PROVIDER_HTTP_ERROR';
  return new PhotoProviderFailure(reason,response.status);
}

export function photoFormat(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg';
  if (bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((n,i) => bytes[i] === n)) return 'png';
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0,4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8,12)) === 'WEBP') return 'webp';
  return null;
}
export async function sha256(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))).map((n) => n.toString(16).padStart(2,'0')).join('');
}
export async function signature(params: Record<string,string>, secret: string): Promise<string> {
  return sha256(new TextEncoder().encode(Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join('&') + secret));
}
export async function boundedBytes(body: ReadableStream<Uint8Array> | null, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!body) throw new Error('VALIDATION_FAILED');
  const reader = body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error('PHOTO_TOO_LARGE'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk,offset); offset += chunk.length; }
  return result;
}
export function validateAsset(asset: PhotoAsset, publicId: string): PhotoAsset {
  if(asset.public_id!==publicId)throw new PhotoProviderFailure('ASSET_ID_MISMATCH');
  if(asset.type!=='authenticated')throw new PhotoProviderFailure('NON_PRIVATE_ASSET');
  if (asset.public_id !== publicId || asset.type !== 'authenticated' || asset.resource_type !== 'image' || !asset.asset_id || !['jpg','png','webp'].includes(asset.format)
    || !Number.isSafeInteger(asset.version) || asset.version <= 0 || !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 || asset.bytes > MAX_PHOTO_BYTES) throw new Error('PHOTO_PROVIDER_FAILED');
  return asset;
}
export async function uploadPhoto(config: CloudinaryConfig, file: Blob, publicId: string, requestFetch: typeof fetch = fetch): Promise<PhotoAsset> {
  // Normalize one bounded profile image on upload; viewing it creates no new
  // Cloudinary variants or transformations. Legacy originals remain readable.
  const parameters = { timestamp: String(Math.floor(Date.now()/1000)), upload_preset: config.preset, public_id: publicId, type: 'authenticated', overwrite: 'false', format: 'webp', transformation: 'a_auto/c_limit,h_512,w_512/q_75,fl_strip_profile' };
  const form = new FormData(); form.set('file',file,'pet-photo');
  for (const [key,value] of Object.entries(parameters)) form.set(key,value);
  form.set('api_key',config.key); form.set('signature',await signature(parameters,config.secret));
  const response = await requestFetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloud)}/image/upload`, { method:'POST', body:form, signal:AbortSignal.timeout(30000) });
  if (response.ok) return validateAsset(await response.json(), publicId);
  const failure=await providerFailure(response);
  // A prior attempt may have uploaded successfully before losing its response.
  // The deterministic, non-overwriting ID lets us recover that same asset.
  if (response.status === 409 || response.status === 400) {
    const existing = await requestFetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloud)}/resources/image/authenticated/${encodeURIComponent(publicId)}`, {
      headers:{ Authorization:`Basic ${btoa(`${config.key}:${config.secret}`)}` }, signal:AbortSignal.timeout(15000),
    });
    if (existing.ok) return validateAsset(await existing.json(),publicId);
  }
  throw failure;
}
export async function downloadPhoto(config: CloudinaryConfig, photo: {public_id:string;format:string;version:number}, requestFetch: typeof fetch = fetch): Promise<Uint8Array<ArrayBuffer>> {
  if(!Number.isSafeInteger(photo.version)||photo.version<=0||!['jpg','png','webp'].includes(photo.format))throw new Error('PHOTO_PROVIDER_FAILED');
  // Match Cloudinary's standard SHA-256 delivery signature. Keep this URL entirely
  // server-side: clients receive authenticated, no-store image bytes only.
  const source=encodeURIComponent(photo.public_id).replace(/%2F/gi,'/')+'.'+photo.format;
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source+config.secret)));
  const token=btoa(String.fromCharCode(...digest)).slice(0,8).replace(/\//g,'_').replace(/\+/g,'-');
  const response = await requestFetch(`https://res.cloudinary.com/${encodeURIComponent(config.cloud)}/image/authenticated/s--${token}--/v${photo.version}/${source}`, { signal:AbortSignal.timeout(20000) });
  if (!response.ok) throw await providerFailure(response);
  const bytes = await boundedBytes(response.body,MAX_PHOTO_BYTES);
  if (!photoFormat(bytes)) throw new Error('PHOTO_PROVIDER_FAILED');
  return bytes;
}
export async function destroyPhoto(config: CloudinaryConfig, publicId: string, requestFetch: typeof fetch = fetch): Promise<void> {
  const parameters = { public_id:publicId, type:'authenticated', invalidate:'true', timestamp:String(Math.floor(Date.now()/1000)) };
  const form = new FormData();
  for (const [key,value] of Object.entries(parameters)) form.set(key,value);
  form.set('api_key',config.key); form.set('signature',await signature(parameters,config.secret));
  const response = await requestFetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloud)}/image/destroy`, { method:'POST', body:form, signal:AbortSignal.timeout(15000) });
  if (!response.ok || !['ok','not found'].includes((await response.json()).result)) throw new Error('PHOTO_PROVIDER_FAILED');
}
