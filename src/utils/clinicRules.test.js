import { describe, expect, it } from 'vitest'
import {
  calculateStockOnHand,
  canApplyStockMovement,
  classifyReminder,
  formatPetRecordNumber,
} from './clinicRules'

describe('classifyReminder', () => {
  it('distinguishes overdue, due, upcoming, and completed reminders', () => {
    expect(classifyReminder('2026-07-28', '2026-07-29')).toBe('Overdue')
    expect(classifyReminder('2026-07-29', '2026-07-29')).toBe('Due')
    expect(classifyReminder('2026-08-01', '2026-07-29')).toBe('Upcoming')
    expect(classifyReminder('2026-07-28', '2026-07-29', true)).toBe('Completed')
  })
})

describe('inventory movement rules', () => {
  it('derives on-hand stock from immutable movements', () => {
    expect(calculateStockOnHand([
      { quantityDelta: 20 },
      { quantityDelta: -3 },
      { quantityDelta: '5' },
    ])).toBe(22)
  })

  it('rejects movements that would make stock negative', () => {
    expect(canApplyStockMovement(5, -5)).toBe(true)
    expect(canApplyStockMovement(5, -6)).toBe(false)
  })
})

describe('formatPetRecordNumber', () => {
  it('creates stable, zero-padded clinic record numbers', () => {
    expect(formatPetRecordNumber(2026, 31)).toBe('VET-2026-00031')
  })

  it('rejects invalid sequences', () => {
    expect(() => formatPetRecordNumber(2026, 0)).toThrow()
  })
})
