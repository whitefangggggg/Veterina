import { describe, expect, it } from 'vitest'
import { createRecentPatientsStore, recentPatientsKey } from './recentPatients'

function fixture() {
  const values = new Map()
  const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }
  return { values, storage, store: createRecentPatientsStore(() => storage) }
}
describe('recent patient context', () => {
  it('persists five unique IDs in last-opened order and moves a revisit to the front', () => {
    const { store, values } = fixture()
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'b']) store.record('key', id)
    expect(store.getSnapshot('key')).toEqual(['b', 'f', 'e', 'd', 'c'])
    expect(JSON.parse(values.get('key'))).toEqual(store.getSnapshot('key'))
  })
  it('isolates users and clinics and refuses unscoped writes', () => {
    const { store, values } = fixture()
    const a = recentPatientsKey('owner', 'clinic-a'), b = recentPatientsKey('staff', 'clinic-a'), c = recentPatientsKey('owner', 'clinic-b')
    store.record(a, 'patient-a'); store.record(b, 'patient-b'); store.record(c, 'patient-c'); store.record(recentPatientsKey('owner', null), 'unsafe')
    expect(store.getSnapshot(a)).toEqual(['patient-a'])
    expect(store.getSnapshot(b)).toEqual(['patient-b'])
    expect(store.getSnapshot(c)).toEqual(['patient-c'])
    expect(values.size).toBe(3)
  })
  it('handles invalid persisted data and never accepts patient objects or clinical content', () => {
    const { store, values } = fixture()
    values.set('broken', '{bad')
    values.set('mixed', JSON.stringify(['valid', null, { id: 'pet', name: 'Private name' }, 'valid']))
    expect(store.getSnapshot('broken')).toEqual([])
    expect(store.getSnapshot('mixed')).toEqual(['valid'])
    store.record('mixed', { id: 'pet', name: 'Private name' })
    expect(store.getSnapshot('mixed')).toEqual(['valid'])
  })
  it('keeps in-memory history usable when browser storage is blocked', () => {
    const store = createRecentPatientsStore(() => { throw new Error('Blocked storage') })
    store.record('key', 'patient'); store.refresh('key')
    expect(store.getSnapshot('key')).toEqual(['patient'])
    store.clear('key')
    expect(store.getSnapshot('key')).toEqual([])
  })
  it('refreshes cross-tab changes, keeps stable snapshots, and clears only the active scope', () => {
    const { store, storage } = fixture()
    store.record('a', 'patient-a'); store.record('b', 'patient-b')
    const snapshot = store.getSnapshot('a')
    store.refresh('a')
    expect(store.getSnapshot('a')).toBe(snapshot)
    storage.setItem('a', '["patient-new"]'); store.refresh('a')
    expect(store.getSnapshot('a')).toEqual(['patient-new'])
    store.clear('a')
    expect(storage.getItem('a')).toBe(null)
    expect(store.getSnapshot('b')).toEqual(['patient-b'])
  })
})
