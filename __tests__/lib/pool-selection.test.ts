import { describe, it, expect } from 'vitest'
import { decideLandingAction } from '@/lib/pool-selection'

describe('decideLandingAction', () => {
  const leagues = [
    { id: 'a', name: 'Pool A' },
    { id: 'b', name: 'Pool B' },
  ]

  it('returns show-create when 0 pools', () => {
    expect(decideLandingAction([], null, false)).toEqual({ action: 'show-create' })
  })

  it('autobounces when exactly 1 pool and no default', () => {
    expect(decideLandingAction([leagues[0]], null, false)).toEqual({
      action: 'redirect',
      poolId: 'a',
    })
  })

  it('autobounces to default when 2+ pools and valid default set', () => {
    expect(decideLandingAction(leagues, 'b', false)).toEqual({
      action: 'redirect',
      poolId: 'b',
    })
  })

  it('clears stale default and shows selector when default pool no longer in list', () => {
    expect(decideLandingAction(leagues, 'gone', false)).toEqual({
      action: 'show-selector',
      clearDefault: true,
    })
  })

  it('shows selector when 2+ pools and no default', () => {
    expect(decideLandingAction(leagues, null, false)).toEqual({ action: 'show-selector' })
  })

  it('honors pickMode by skipping redirects even with 1 pool', () => {
    expect(decideLandingAction([leagues[0]], null, true)).toEqual({ action: 'show-selector' })
  })

  it('honors pickMode by skipping redirects even with a valid default', () => {
    expect(decideLandingAction(leagues, 'b', true)).toEqual({ action: 'show-selector' })
  })

  it('still shows create when 0 pools even in pickMode', () => {
    expect(decideLandingAction([], null, true)).toEqual({ action: 'show-create' })
  })
})
