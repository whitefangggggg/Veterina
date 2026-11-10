import { describe, expect, it } from 'vitest'
import { clinicalCursorCodec } from './admissionTrackingCursor'

describe('clinical pagination cursors', () => {
  const point = { at: '2026-11-09T01:00:00.123456+00:00', id: '12345678-1234-1234-1234-123456789abc' }
  it('encrypts identifiers and binds cursors to credential, section, secret and expiration', async () => {
    let now = Date.now()
    const codec = clinicalCursorCodec('server-only-secret', () => now)
    const cursor = await codec.seal(point, 'Abc1234567890', 'monitoring')
    expect(cursor).not.toContain(point.id)
    expect(await codec.open(cursor, 'Abc1234567890', 'monitoring')).toEqual(point)
    expect(await codec.open(cursor, 'Xbc1234567890', 'monitoring')).toBeNull()
    expect(await codec.open(cursor, 'Abc1234567890', 'orders')).toBeNull()
    expect(await clinicalCursorCodec('different-secret').open(cursor, 'Abc1234567890', 'monitoring')).toBeNull()
    expect(await codec.open(cursor.slice(0, 30) + 'x' + cursor.slice(31), 'Abc1234567890', 'monitoring')).toBeNull()
    expect(await codec.open('x'.repeat(1025), 'Abc1234567890', 'monitoring')).toBeNull()
    now += 15 * 60_000
    expect(await codec.open(cursor, 'Abc1234567890', 'monitoring')).toBeNull()
  })
})
