import { describe, it, expect } from 'vitest'
import { rosterTotal } from '../../lib/roster'

describe('rosterTotal', () => {
  it('sums F + D + G', () => {
    expect(rosterTotal({ rosterForwards: 9, rosterDefense: 4, rosterGoalies: 2 })).toBe(15)
    expect(rosterTotal({ rosterForwards: 1, rosterDefense: 1, rosterGoalies: 1 })).toBe(3)
    expect(rosterTotal({ rosterForwards: 12, rosterDefense: 8, rosterGoalies: 4 })).toBe(24)
  })
})
