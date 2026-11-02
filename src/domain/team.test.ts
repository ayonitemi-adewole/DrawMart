import { describe, expect, it } from 'vitest'
import { canDo, inviteError, lastOwnerError } from './team'

describe('store teams', () => {
  it('gives each role its own work', () => {
    expect(['orders', 'shop', 'bank', 'team'].map((p) => canDo('owner', p as never))).toEqual([true, true, true, true])
    expect(['orders', 'shop', 'bank', 'team'].map((p) => canDo('manager', p as never))).toEqual([true, true, false, false])
    expect(['orders', 'shop', 'bank', 'team'].map((p) => canDo('orders', p as never))).toEqual([true, false, false, false])
    // Individual sellers and stores from before teams.
    expect(canDo(null, 'bank')).toBe(true)
  })

  it('checks an invite', () => {
    expect(inviteError('ada@shop.ng', 'manager')).toBeNull()
    expect(inviteError('ada', 'manager')).not.toBeNull()
    expect(inviteError('ada@shop.ng', null)).not.toBeNull()
  })

  it('always keeps an owner', () => {
    const team = [{ userId: 'a', role: 'owner' as const }, { userId: 'b', role: 'manager' as const }]
    expect(lastOwnerError(team, 'a', 'manager')).not.toBeNull()
    expect(lastOwnerError(team, 'a', null)).not.toBeNull()
    expect(lastOwnerError(team, 'b', null)).toBeNull()
    expect(lastOwnerError([...team, { userId: 'c', role: 'owner' }], 'a', null)).toBeNull()
  })
})
