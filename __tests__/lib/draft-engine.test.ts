import { describe, it, expect } from 'vitest'
import { getPickerIndex, getRound, getTotalPicks } from '../../lib/draft-engine'

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
