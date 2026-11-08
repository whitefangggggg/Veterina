/* oxlint-disable react/only-export-components */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useState } from 'react'
import { appearanceStorageKey, applyAppearance, normalizeAppearance, readAppearance, resolveAppearance } from '../lib/appearance'

const AppearanceContext = createContext(null)

export function AppearanceProvider({ children }) {
  const [mode, setMode] = useState(readAppearance)
  const [prefersDark, setPrefersDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  const resolvedMode = resolveAppearance(mode, prefersDark)

  useLayoutEffect(() => { applyAppearance(mode, prefersDark) }, [mode, prefersDark])
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const changed = () => setPrefersDark(media.matches)
    const stored = (event) => {
      if (event.key === appearanceStorageKey || event.key === null) setMode(readAppearance())
    }
    changed()
    media.addEventListener('change', changed)
    window.addEventListener('storage', stored)
    return () => { media.removeEventListener('change', changed); window.removeEventListener('storage', stored) }
  }, [])

  const setAppearance = useCallback((value) => {
    const next = normalizeAppearance(value)
    try { localStorage.setItem(appearanceStorageKey, next) } catch { /* Keep this session usable without storage. */ }
    setMode(next)
  }, [])

  return <AppearanceContext.Provider value={{ mode, resolvedMode, setMode: setAppearance }}>{children}</AppearanceContext.Provider>
}

export function useAppearance() {
  const context = useContext(AppearanceContext)
  if (!context) throw new Error('useAppearance must be used inside AppearanceProvider')
  return context
}
