import { Bird, Cat, Dog, PawPrint, Rabbit } from '@phosphor-icons/react'

const speciesIcons = {
  Dog,
  Cat,
  Bird,
  Rabbit,
}

export default function PetSticker({ pet, size = 'medium', className = '' }) {
  const Icon = speciesIcons[pet?.species] || PawPrint
  return (
    <span
      className={`pet-sticker pet-sticker-${size} ${className}`}
      style={{ '--sticker-color': pet?.photoColor || '#78a99a' }}
      aria-hidden="true"
    >
      <Icon weight="duotone" />
    </span>
  )
}
