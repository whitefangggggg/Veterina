import { describe, expect, it } from 'vitest'
import { MAX_PET_PHOTO_BYTES, validatePetPhoto } from './petPhotos'

describe('pet photo selection', () => {
  it('accepts an image exactly at the size limit', async () => {
    const content = new Uint8Array(MAX_PET_PHOTO_BYTES); content.set([255,216,255])
    await expect(validatePetPhoto(new Blob([content]))).resolves.toBeUndefined()
  })
  it('rejects oversized, empty and falsely labelled files', async () => {
    await expect(validatePetPhoto(new Blob([new Uint8Array(MAX_PET_PHOTO_BYTES + 1)]))).rejects.toThrow('5 MB')
    await expect(validatePetPhoto(new Blob([]))).rejects.toThrow('Choose')
    await expect(validatePetPhoto(new Blob(['<svg/>'], { type: 'image/jpeg' }))).rejects.toThrow('Choose')
  })
})
