import { describe, expect, it, vi } from 'vitest'
import { boundedBytes, downloadPhoto, MAX_PHOTO_BYTES, photoFormat, signature, uploadPhoto, validateAsset } from './petPhotos'

const config = { cloud: 'test-cloud', key: 'test-key', secret: 'test-secret', preset: 'test-preset' }
const asset = { public_id: 'veterina/pet-photos/test', asset_id: 'asset', version: 1, bytes: 20, format: 'jpg', type: 'authenticated', resource_type: 'image' }
const jpeg = new Uint8Array([255,216,255,0,1])
describe('private photo transport', () => {
  it('recognizes only supported image signatures', () => {
    expect(photoFormat(jpeg)).toBe('jpg')
    expect(photoFormat(new Uint8Array([137,80,78,71,13,10,26,10]))).toBe('png')
    expect(photoFormat(new TextEncoder().encode('RIFFxxxxWEBP'))).toBe('webp')
    expect(photoFormat(new TextEncoder().encode('<svg>'))).toBeNull()
  })
  it('bounds streamed bodies rather than trusting Content-Length', async () => {
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4)); controller.enqueue(new Uint8Array(4)); controller.close() } })
    await expect(boundedBytes(stream, 5)).rejects.toThrow('PHOTO_TOO_LARGE')
    const boundary = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_PHOTO_BYTES)); controller.close() } })
    expect((await boundedBytes(boundary, MAX_PHOTO_BYTES)).length).toBe(MAX_PHOTO_BYTES)
  })
  it('signs canonical parameter order', async () => {
    expect(await signature({ b: 'two', a: 'one' }, 'test-secret')).toBe(await signature({ a: 'one', b: 'two' }, 'test-secret'))
    expect(await signature({ a: 'other' }, 'test-secret')).not.toBe(await signature({ a: 'one' }, 'test-secret'))
  })
  it('rejects public delivery, mismatched IDs, invalid images and provider size violations', () => {
    for (const change of [{ type: 'upload' }, { public_id: 'other' }, { bytes: MAX_PHOTO_BYTES + 1 }, { resource_type: 'raw' }, { format: 'svg' }]) {
      expect(() => validateAsset({ ...asset, ...change }, asset.public_id)).toThrow('PHOTO_PROVIDER_FAILED')
    }
  })
  it('uses authenticated, non-overwriting upload parameters without sending the secret', async () => {
    const request = vi.fn().mockResolvedValue(Response.json(asset))
    await uploadPhoto(config, new Blob([jpeg]), asset.public_id, request)
    const form = request.mock.calls[0][1].body as FormData
    expect(form.get('type')).toBe('authenticated')
    expect(form.get('overwrite')).toBe('false')
    expect(form.get('upload_preset')).toBe(config.preset)
    expect(form.get('format')).toBe('webp')
    expect(form.get('transformation')).toContain('c_limit,h_512,w_512')
    expect(form.get('transformation')).toContain('q_75')
    expect([...form.values()].some((value) => value === config.secret)).toBe(false)
  })
  it('recovers the same asset after a lost upload response', async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 409 })).mockResolvedValueOnce(Response.json(asset))
    expect((await uploadPhoto(config, new Blob([jpeg]), asset.public_id, request)).asset_id).toBe('asset')
    expect(request.mock.calls[1][0]).toContain('/resources/image/authenticated/')
  })
  it('returns only fixed diagnostic categories when provider errors contain credentials', async () => {
    const request=vi.fn().mockResolvedValue(Response.json({error:{message:'Invalid Signature private-value'}},{status:401}))
    await expect(uploadPhoto(config,new Blob([jpeg]),asset.public_id,request)).rejects.toMatchObject({message:'PHOTO_PROVIDER_FAILED',reason:'INVALID_SIGNATURE',status:401})
    try { await uploadPhoto(config,new Blob([jpeg]),asset.public_id,request) } catch (error) { expect(JSON.stringify(error)).not.toContain('private-value') }
  })
  it('uses stable signed private CDN delivery without per-view transformations or API download charges', async () => {
    const request = vi.fn().mockImplementation(async () => new Response(jpeg))
    expect(await downloadPhoto(config, asset, request)).toEqual(jpeg)
    const url=String(request.mock.calls[0][0])
    expect(url).toMatch(/^https:\/\/res\.cloudinary\.com\/test-cloud\/image\/authenticated\/s--[A-Za-z0-9_-]{8}--\/v1\/veterina\/pet-photos\/test.jpg$/)
    expect(url).not.toContain('?')
    expect(url).not.toContain('api_key')
    await downloadPhoto(config, asset, request)
    expect(request.mock.calls[1][0]).toBe(url)
    expect(request.mock.calls[0][0]).not.toContain(config.secret)
    await expect(downloadPhoto(config, asset, vi.fn().mockResolvedValue(new Response('<html>')))).rejects.toThrow('PHOTO_PROVIDER_FAILED')
  })
})
