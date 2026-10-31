export const MAX_LOGO_FILE_BYTES = 5_000_000
export const MAX_LOGO_DATA_LENGTH = 400_000

// Only embedded raster images are accepted in exported prescription documents.
export function isClinicLogoDataUrl(value) {
  return typeof value === 'string' && value.length <= MAX_LOGO_DATA_LENGTH
    && /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(value)
}

export async function prepareClinicLogo(file) {
  if (!file?.size) throw new Error('Choose a PNG, JPEG or WebP logo.')
  if (file.size > MAX_LOGO_FILE_BYTES) throw new Error('Choose a logo that is 5 MB or smaller.')
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  const png = [137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value)
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  const text = new TextDecoder()
  const webp = text.decode(bytes.slice(0, 4)) === 'RIFF' && text.decode(bytes.slice(8, 12)) === 'WEBP'
  if (!png && !jpeg && !webp) throw new Error('Choose a PNG, JPEG or WebP logo.')
  let image
  try { image = await createImageBitmap(file) }
  catch { throw new Error('This logo could not be opened. Choose another image.') }
  try {
    if (!image.width || !image.height || image.width * image.height > 25_000_000) throw new Error('Choose a logo smaller than 25 megapixels.')
    const scale = Math.min(1, 256 / Math.max(image.width, image.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.width * scale))
    canvas.height = Math.max(1, Math.round(image.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Logo preparation is unavailable. Please try another browser.')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/png')
    if (!isClinicLogoDataUrl(dataUrl)) throw new Error('The logo could not be prepared. Choose another image.')
    return dataUrl
  } finally { image.close() }
}
