import { supabase } from './supabaseClient'
import { petPhotoCache } from './petPhotoCache'

export const MAX_PET_PHOTO_BYTES = 5_000_000
export async function validatePetPhoto(file) {
  if (!file || !file.size) throw new Error('Choose a JPEG, PNG or WebP image.')
  if (file.size > MAX_PET_PHOTO_BYTES) throw new Error('Photos must be 5 MB or smaller.')
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  const png = [137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value)
  const webp = new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
  if (!jpeg && !png && !webp) throw new Error('Choose a JPEG, PNG or WebP image.')
}

export async function petPhotoRequest(payload, file) {
  let body = payload
  if (file) {
    body = new FormData()
    for (const [key, value] of Object.entries(payload)) body.set(key, String(value))
    body.set('file', file)
  }
  const { data, error, response } = await supabase.functions.invoke('pet-photo', { body })
  if (error) {
    let code = ''
    if (error.context instanceof Response) code = (await error.context.clone().json().catch(() => ({}))).error
    const messages = {
      PHOTO_TOO_LARGE: 'Photos must be 5 MB or smaller.', PHOTO_INVALID_FORMAT: 'Choose a JPEG, PNG or WebP image.',
      PHOTO_CONFLICT: 'This photo changed in another session. Close and reopen the patient editor before replacing it.',
      PHOTO_BUSY: 'This photo is still processing. Wait a moment and retry.', PROVIDER_NOT_CONFIGURED: 'Photo uploads are temporarily unavailable. You can continue without a photo.',
      PHOTO_PROVIDER_FAILED: 'The photo service could not complete this request. Please retry.',
      FORBIDDEN: 'Your account cannot access this photo.', UNAUTHENTICATED: 'Sign in again to access pet photos.',
    }
    throw new Error(messages[code] || 'The photo could not be processed. Please retry.')
  }
  // functions-js parses binary responses as blobs only for octet-stream.
  if (payload.action === 'read' && data instanceof Blob) {
    const type = response.headers.get('X-Pet-Photo-Type')
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) throw new Error('Invalid photo response.')
    return new Blob([data], { type })
  }
  if (file || payload.action === 'remove') petPhotoCache.invalidate(payload.petId)
  return data
}
