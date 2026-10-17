import { describe, expect, it } from 'vitest'
import {
  calculateStockOnHand,
  canApplyStockMovement,
  classifyReminder,
  formatPetRecordNumber,
  vaccinationStatus,
  visibleQueueEntries,
} from './clinicRules'

describe('vaccination next-dose status', () => {
  it('distinguishes missing, future, today, and overdue next doses', () => {
    expect(vaccinationStatus(null, '2026-10-17')).toBe('No next dose scheduled')
    expect(vaccinationStatus('', '2026-10-17')).toBe('No next dose scheduled')
    expect(vaccinationStatus('2026-10-18', '2026-10-17')).toBe('Up to date')
    expect(vaccinationStatus('2026-10-17', '2026-10-17')).toBe('Due today')
    expect(vaccinationStatus('2026-10-16', '2026-10-17')).toBe('Overdue')
  })
})

describe('queue worklist', () => {
  it('orders tickets by saved date and sequence, including identical arrival times', () => {
    const numbered = [
      { id: 'a', status: 'waiting', queueDate: '2026-10-17', queueSequence: 2, arrivedAt: '2026-10-17T01:00:00Z' },
      { id: 'b', status: 'waiting', queueDate: '2026-10-16', queueSequence: 14, arrivedAt: '2026-10-16T01:00:00Z' },
      { id: 'c', status: 'waiting', queueDate: '2026-10-17', queueSequence: 1, arrivedAt: '2026-10-17T01:00:00Z' },
    ]
    expect(visibleQueueEntries(numbered, { date: '2026-10-17' }).map((entry) => entry.id)).toEqual(['b', 'c', 'a'])
  })
  const entries = [
    { id: 'new', status: 'waiting', category: 'vaccination', arrivedAt: '2026-10-17T02:00:00Z' },
    { id: 'old', status: 'in_progress', category: 'checkup', arrivedAt: '2026-10-16T02:00:00Z' },
    { id: 'done', status: 'completed', category: 'checkup', arrivedAt: '2026-10-16T01:00:00Z', finishedDate: '2026-10-17' },
    { id: 'cancel', status: 'cancelled', category: 'vaccination', arrivedAt: '2026-10-15T01:00:00Z', finishedDate: '2026-10-16' },
  ]
  it('retains carryover arrivals and orders active work by arrival', () => {
    expect(visibleQueueEntries(entries, { date: '2026-10-17' }).map((entry) => entry.id)).toEqual(['old', 'new'])
  })
  it('combines independent service, state, and terminal-history date filters', () => {
    expect(visibleQueueEntries(entries, { status: 'All', date: '2026-10-17' }).map((entry) => entry.id)).toEqual(['done', 'old', 'new'])
    expect(visibleQueueEntries(entries, { service: 'vaccination', status: 'All', date: '2026-10-16' }).map((entry) => entry.id)).toEqual(['cancel', 'new'])
    expect(visibleQueueEntries(entries, { status: 'completed', date: '2026-10-17' }).map((entry) => entry.id)).toEqual(['done'])
    expect(entries.map((entry) => entry.id)).toEqual(['new', 'old', 'done', 'cancel'])
  })
})

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
