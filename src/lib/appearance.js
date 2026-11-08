export const appearanceStorageKey = 'veterina-appearance'
export const appearanceModes = ['light', 'dark', 'system']

export function normalizeAppearance(value) {
  return appearanceModes.includes(value) ? value : 'system'
}

export function readAppearance() {
  try { return normalizeAppearance(localStorage.getItem(appearanceStorageKey)) }
  catch { return 'system' }
}

export function resolveAppearance(mode, prefersDark) {
  const normalized = normalizeAppearance(mode)
  return normalized === 'system' ? (prefersDark ? 'dark' : 'light') : normalized
}

export function applyAppearance(mode, prefersDark) {
  const resolved = resolveAppearance(mode, prefersDark)
  document.documentElement.dataset.appearance = resolved
  document.documentElement.style.colorScheme = resolved
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#111b19' : '#f3f5f2')
  return resolved
}
