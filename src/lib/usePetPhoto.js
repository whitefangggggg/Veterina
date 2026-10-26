import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { petPhotoRequest } from './petPhotos'
import { petPhotoCache } from './petPhotoCache'

export function usePetPhoto(pet, enabled = true) {
  const { user, profile } = useAuth()
  const allowed = enabled && user?.id && profile?.is_active && pet?.has_photo
  const key = allowed ? JSON.stringify([user.id, pet.id, pet.photo_revision]) : ''
  const [, refresh] = useState(0)
  useEffect(() => {
    if (!allowed) return
    const lease = petPhotoCache.acquire(user.id, pet.id, pet.photo_revision, () => petPhotoRequest({ action: 'read', petId: pet.id }))
    let current = true
    lease.promise.then(() => { if (current) refresh((revision) => revision + 1) })
    return () => {
      current = false; lease.release()
    }
  }, [key, allowed, user?.id, pet?.id, pet?.photo_revision])
  return allowed ? petPhotoCache.peek(user.id, pet.id, pet.photo_revision) : null
}
