import { Bird, Cat, Dog, PawPrint, Rabbit } from '@phosphor-icons/react'
import { usePetPhoto } from '../lib/usePetPhoto'
import { useEffect, useRef, useState } from 'react'

const speciesIcons = {
  Dog,
  Cat,
  Bird,
  Rabbit,
}

export default function PetSticker({ pet, size = 'medium', className = '' }) {
  const Icon = speciesIcons[pet?.species] || PawPrint
  const element = useRef(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!globalThis.IntersectionObserver) { setVisible(true); return }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '160px' })
    observer.observe(element.current)
    return () => observer.disconnect()
  }, [])
  const photo = usePetPhoto(pet, visible)
  const [failedPhoto, setFailedPhoto] = useState(null)
  return (
    <span
      ref={element}
      className={`pet-sticker pet-sticker-${size} ${className}`}
      style={{ '--sticker-color': pet?.photoColor || '#78a99a' }}
      aria-hidden="true"
    >
      {photo && failedPhoto !== photo ? <img src={photo} alt="" decoding="async" onError={() => setFailedPhoto(photo)} /> : <Icon weight="duotone" />}
    </span>
  )
}
