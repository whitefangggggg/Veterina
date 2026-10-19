import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

// Run after the lazy page and its saved records have rendered, including when
// a citation changes only the fragment on the current route.
export function useHashTarget() {
  const { pathname, search, hash } = useLocation()
  let targetId = ''
  try { targetId = decodeURIComponent(hash.slice(1)) } catch { targetId = hash.slice(1) }
  useEffect(() => {
    if (!targetId) return
    const frame = requestAnimationFrame(() => {
      const element = document.getElementById(targetId)
      if (!element) return
      element.setAttribute('tabindex', '-1')
      element.focus({ preventScroll: true })
      element.scrollIntoView({ block: 'start' })
    })
    return () => cancelAnimationFrame(frame)
  }, [pathname, search, targetId])
  return targetId
}
