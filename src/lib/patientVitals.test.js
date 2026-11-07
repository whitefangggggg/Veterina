import { describe, expect, it } from 'vitest'
import { patientVitals, visitDateTime } from './patientVitals'

describe('patient vitals', () => {
  it('retains partial visit vitals, excludes missing weights and orders separate same-month visits', () => {
    const input = [
      { id: 'old', visitedAt: '2026-11-01T00:00:00Z', weightKg: 8.48 },
      { id: 'new', visitedAt: '2026-11-06T00:00:00Z', weightKg: '6.7', bodyConditionScore: 3, bodyConditionScale: 5 },
      { id: 'partial', visitedAt: '2026-11-07T00:00:00Z', weightKg: null, temperatureC: 38.5 },
      { id: 'empty', visitedAt: '2026-11-08T00:00:00Z', weightKg: null },
      { id: 'bad', visitedAt: 'invalid', weightKg: 10 },
    ]
    const { rows, weights, domain } = patientVitals(input, 'Asia/Manila')
    expect(rows.map((row) => row.id)).toEqual(['partial', 'new', 'old'])
    expect(weights.map(({ visitId, weight, date }) => [visitId, weight, date])).toEqual([['old', 8.48, '2026-11-01'], ['new', 6.7, '2026-11-06']])
    expect(rows[1].bodyConditionScale).toBe(5)
    expect(domain[0]).toBeLessThan(6.7)
    expect(domain[1]).toBeGreaterThan(8.48)
    expect(input.map((row) => row.id)).toEqual(['old', 'new', 'partial', 'empty', 'bad'])
  })
  it('handles zero, missing, single, identical, same-time and very small weights without a negative axis', () => {
    const visits = [null, '', 0, -1, NaN, Infinity, 0.05, 0.05].map((weightKg, index) => ({ id: String(index), weightKg, visitedAt: '2026-11-06T00:00:00Z' }))
    const result = patientVitals(visits, 'Asia/Manila')
    expect(result.weights).toHaveLength(2)
    expect(result.weights.map((point) => point.visitId)).toEqual(['7', '6'])
    expect(result.domain[0]).toBe(0)
    expect(result.domain[1]).toBeGreaterThan(0.05)
    expect(patientVitals([visits[6]], 'Asia/Manila').weights).toHaveLength(1)
    expect(patientVitals([], 'Asia/Manila').rows).toEqual([])
  })
  it('uses clinic-local day and year boundaries and preserves undated source information', () => {
    const result = patientVitals([{ id: 'a', visitedAt: '2026-12-31T17:00:00Z', heartRate: 100, weightKg: 7.5 }], 'Asia/Manila')
    expect(result.weights[0].date).toBe('2027-01-01')
    expect(visitDateTime('2026-12-31T17:00:00Z', 'Asia/Manila')).toBe('1 Jan 2027, 01:00')
    expect(visitDateTime('2026-12-31', 'America/Los_Angeles')).toBe('31 Dec 2026')
    expect(visitDateTime(null, 'Asia/Manila')).toBe('Not recorded')
  })
})
