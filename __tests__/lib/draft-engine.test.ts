import { describe, it, expect } from 'vitest'
import { vi } from 'vitest'
import { getPickerIndex, getRound, getTotalPicks, getAutoPickPlayerId } from '../../lib/draft-engine'

describe('getPickerIndex — snake draft order', () => {
  // 4-member league: positions 0,1,2,3
  it('round 1 picks left to right (odd round)', () => {
    expect(getPickerIndex(1, 4)).toBe(0)
    expect(getPickerIndex(2, 4)).toBe(1)
    expect(getPickerIndex(3, 4)).toBe(2)
    expect(getPickerIndex(4, 4)).toBe(3)
  })
  it('round 2 picks right to left (even round)', () => {
    expect(getPickerIndex(5, 4)).toBe(3)
    expect(getPickerIndex(6, 4)).toBe(2)
    expect(getPickerIndex(7, 4)).toBe(1)
    expect(getPickerIndex(8, 4)).toBe(0)
  })
  it('round 3 picks left to right again', () => {
    expect(getPickerIndex(9, 4)).toBe(0)
    expect(getPickerIndex(10, 4)).toBe(1)
    expect(getPickerIndex(12, 4)).toBe(3)
  })
  it('2-member snake reversal', () => {
    expect(getPickerIndex(1, 2)).toBe(0) // round 1 pos 0
    expect(getPickerIndex(2, 2)).toBe(1) // round 1 pos 1
    expect(getPickerIndex(3, 2)).toBe(1) // round 2 pos 1 (reversed)
    expect(getPickerIndex(4, 2)).toBe(0) // round 2 pos 0 (reversed)
    expect(getPickerIndex(5, 2)).toBe(0) // round 3 pos 0 again
  })
  it('1-member league always returns 0', () => {
    expect(getPickerIndex(1, 1)).toBe(0)
    expect(getPickerIndex(5, 1)).toBe(0)
  })
})

describe('getTotalPicks', () => {
  it('returns memberCount × playersPerTeam', () => {
    expect(getTotalPicks(8, 10)).toBe(80)
    expect(getTotalPicks(4, 5)).toBe(20)
    expect(getTotalPicks(1, 3)).toBe(3)
  })
})

describe('getRound', () => {
  it('calculates correct round for 4-member league', () => {
    expect(getRound(1, 4)).toBe(1)
    expect(getRound(4, 4)).toBe(1)
    expect(getRound(5, 4)).toBe(2)
    expect(getRound(8, 4)).toBe(2)
    expect(getRound(9, 4)).toBe(3)
  })
})

describe('getAutoPickPlayerId', () => {
  function makeTx({
    picks = [] as { playerId: number }[],
    wishlist = [] as { playerId: number }[],
    bestPlayer = null as { id: number } | null,
  } = {}) {
    return {
      draftPick: { findMany: vi.fn().mockResolvedValue(picks) },
      autodraftWishlist: { findMany: vi.fn().mockResolvedValue(wishlist) },
      nhlPlayer: { findFirst: vi.fn().mockResolvedValue(bestPlayer) },
    }
  }

  it('strategy=adp: returns best player by ADP without checking wishlist', async () => {
    const tx = makeTx({ bestPlayer: { id: 42 } })
    const result = await getAutoPickPlayerId('draft-1', 'member-1', 'adp', tx as never)
    expect(result).toBe(42)
    expect(tx.autodraftWishlist.findMany).not.toHaveBeenCalled()
  })

  it('strategy=wishlist: returns first available wishlist player', async () => {
    const tx = makeTx({
      picks: [{ playerId: 10 }],
      wishlist: [{ playerId: 10 }, { playerId: 20 }], // 10 is drafted, 20 is available
      bestPlayer: { id: 99 },
    })
    const result = await getAutoPickPlayerId('draft-1', 'member-1', 'wishlist', tx as never)
    expect(result).toBe(20)
    expect(tx.nhlPlayer.findFirst).not.toHaveBeenCalled()
  })

  it('strategy=wishlist: falls back to ADP when all wishlist players are drafted', async () => {
    const tx = makeTx({
      picks: [{ playerId: 10 }, { playerId: 20 }],
      wishlist: [{ playerId: 10 }, { playerId: 20 }],
      bestPlayer: { id: 99 },
    })
    const result = await getAutoPickPlayerId('draft-1', 'member-1', 'wishlist', tx as never)
    expect(result).toBe(99)
  })

  it('throws when no players are available', async () => {
    const tx = makeTx({ bestPlayer: null })
    await expect(
      getAutoPickPlayerId('draft-1', 'member-1', 'adp', tx as never)
    ).rejects.toThrow('No available players for auto-pick')
  })
})
