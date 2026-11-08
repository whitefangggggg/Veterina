import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeAppearance, readAppearance, resolveAppearance } from './appearance'

afterEach(() => vi.unstubAllGlobals())

describe('browser appearance preference', () => {
  it('defaults missing and invalid preferences to system', () => {
    for (const value of [null, undefined, '', 'broken', '<script>']) expect(normalizeAppearance(value)).toBe('system')
    for (const value of ['light', 'dark', 'system']) expect(normalizeAppearance(value)).toBe(value)
  })
  it('follows the device only in system mode', () => {
    expect(resolveAppearance('system', true)).toBe('dark')
    expect(resolveAppearance('system', false)).toBe('light')
    expect(resolveAppearance('light', true)).toBe('light')
    expect(resolveAppearance('dark', false)).toBe('dark')
  })
  it('reads saved preferences and handles inaccessible storage', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'dark' })
    expect(readAppearance()).toBe('dark')
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('Storage blocked') } })
    expect(readAppearance()).toBe('system')
  })
})
