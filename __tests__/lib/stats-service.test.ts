import { describe, it, expect, vi, beforeEach } from 'vitest'
import { calculatePlayerScore, calculateMemberScore, writeMemberDailyScores } from '../../lib/stats-service'

// Mock prisma for writeMemberDailyScores tests
// vi.hoisted ensures the object is created before vi.mock hoisting runs
const mockPrismaForDaily = vi.hoisted(() => ({
  scoringSettings: { findUnique: vi.fn() },
  leagueMember: { findMany: vi.fn() },
  memberDailyScore: { upsert: vi.fn() },
}))

vi.mock('../../lib/prisma', () => ({ prisma: mockPrismaForDaily }))

const DEFAULT_WEIGHTS = {
  goals: 2.0, assists: 1.5, plusMinus: 0.5, pim: 0.0, shots: 0.1,
  hits: 0.0, blockedShots: 0.0,
  powerPlayGoals: 0.5, powerPlayPoints: 0.0, powerPlayAssists: 0.0,
  shorthandedGoals: 0.0, shorthandedPoints: 0.0, shorthandedAssists: 0.0,
  gameWinningGoals: 1.0, overtimeGoals: 1.0, overtimeAssists: 0.0,
  goalieWins: 3.0, goalieSaves: 0.2, shutouts: 5.0, goalsAgainst: 0.0,
}

const ZERO_STATS = {
  goals: 0, assists: 0, plusMinus: 0, pim: 0, shots: 0,
  hits: 0, blockedShots: 0,
  powerPlayGoals: 0, powerPlayPoints: 0, powerPlayAssists: 0,
  shorthandedGoals: 0, shorthandedPoints: 0, shorthandedAssists: 0,
  gameWinningGoals: 0, overtimeGoals: 0, overtimeAssists: 0,
  goalieWins: 0, goalieSaves: 0, shutouts: 0, goalsAgainst: 0,
}

describe('calculatePlayerScore', () => {
  it('calculates weighted score for a skater game', () => {
    const gameStats = {
      ...ZERO_STATS,
      goals: 2, assists: 1, plusMinus: 1, pim: 2, shots: 5,
      hits: 3, blockedShots: 1, powerPlayGoals: 1, powerPlayPoints: 1,
      gameWinningGoals: 1,
    }
    const score = calculatePlayerScore(gameStats, DEFAULT_WEIGHTS)
    // goals: 2*2.0=4.0, assists: 1*1.5=1.5, plusMinus: 1*0.5=0.5,
    // pim: 2*0.0=0, shots: 5*0.1=0.5, ppGoals: 1*0.5=0.5, gwg: 1*1.0=1.0
    expect(score).toBeCloseTo(8.0)
  })

  it('calculates weighted score for a goalie game', () => {
    const gameStats = {
      ...ZERO_STATS,
      goalieWins: 1, goalieSaves: 30, shutouts: 1,
    }
    const score = calculatePlayerScore(gameStats, DEFAULT_WEIGHTS)
    // wins: 1*3.0=3.0, saves: 30*0.2=6.0, shutouts: 1*5.0=5.0
    expect(score).toBeCloseTo(14.0)
  })

  it('subtracts goalsAgainst when weight is set', () => {
    const gameStats = {
      ...ZERO_STATS,
      goalieWins: 1, goalieSaves: 25, goalsAgainst: 3,
    }
    const weights = { ...DEFAULT_WEIGHTS, goalsAgainst: 1.0 }
    const score = calculatePlayerScore(gameStats, weights)
    // wins: 3.0, saves: 5.0, goalsAgainst: -3*1.0=-3.0
    expect(score).toBeCloseTo(5.0)
  })

  it('returns zero when all weights are zero', () => {
    const gameStats = {
      ...ZERO_STATS,
      goals: 5, assists: 3, plusMinus: 2, pim: 4, shots: 10,
      hits: 5, blockedShots: 2, powerPlayGoals: 2, powerPlayPoints: 3,
      shorthandedGoals: 1, shorthandedPoints: 1, gameWinningGoals: 1,
      overtimeGoals: 1,
    }
    const zeroWeights = Object.fromEntries(
      Object.keys(DEFAULT_WEIGHTS).map(k => [k, 0])
    ) as typeof DEFAULT_WEIGHTS
    expect(calculatePlayerScore(gameStats, zeroWeights)).toBe(0)
  })
})

describe('calculateMemberScore', () => {
  it('sums scores across multiple games for multiple players', () => {
    const playerGames = [
      { ...ZERO_STATS, goals: 1, shots: 3 },
      { ...ZERO_STATS, assists: 2, plusMinus: 1, shots: 2 },
    ]
    const total = calculateMemberScore(playerGames, DEFAULT_WEIGHTS)
    // Game 1: 1*2.0 + 3*0.1 = 2.3
    // Game 2: 2*1.5 + 1*0.5 + 2*0.1 = 3.7
    expect(total).toBeCloseTo(6.0)
  })

  it('returns zero for empty game list', () => {
    expect(calculateMemberScore([], DEFAULT_WEIGHTS)).toBe(0)
  })
})

const WEIGHTS = {
  goals: 2.0, assists: 1.5, plusMinus: 0.5, pim: 0.0, shots: 0.1,
  hits: 0.0, blockedShots: 0.0,
  powerPlayGoals: 0.5, powerPlayPoints: 0.0, powerPlayAssists: 0.0,
  shorthandedGoals: 0.0, shorthandedPoints: 0.0, shorthandedAssists: 0.0,
  gameWinningGoals: 1.0, overtimeGoals: 1.0, overtimeAssists: 0.0,
  goalieWins: 3.0, goalieSaves: 0.2, shutouts: 5.0, goalsAgainst: 0.0,
}

const MOCK_GAME_STATS_BASE = {
  goals: 0, assists: 0, plusMinus: 0, pim: 0, shots: 0, hits: 0, blockedShots: 0,
  powerPlayGoals: 0, powerPlayPoints: 0, powerPlayAssists: 0,
  shorthandedGoals: 0, shorthandedPoints: 0, shorthandedAssists: 0,
  gameWinningGoals: 0, overtimeGoals: 0, overtimeAssists: 0,
  goalieWins: 0, goalieSaves: 0, shutouts: 0, goalsAgainst: 0,
}

describe('writeMemberDailyScores', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrismaForDaily.scoringSettings.findUnique.mockResolvedValue(WEIGHTS)
    mockPrismaForDaily.memberDailyScore.upsert.mockResolvedValue({})
  })

  it('returns 0 when no scoring settings exist', async () => {
    mockPrismaForDaily.scoringSettings.findUnique.mockResolvedValue(null)
    const count = await writeMemberDailyScores('league-1', '2026-04-14')
    expect(count).toBe(0)
    expect(mockPrismaForDaily.memberDailyScore.upsert).not.toHaveBeenCalled()
  })

  it('upserts a daily score row per member', async () => {
    mockPrismaForDaily.leagueMember.findMany.mockResolvedValue([
      {
        id: 'member-1',
        draftPicks: [
          {
            playerId: 1,
            player: {
              team: { eliminatedAt: null },
              gameStats: [
                { ...MOCK_GAME_STATS_BASE, goals: 1, assists: 1, plusMinus: 1, shots: 3 },
              ],
            },
          },
        ],
      },
    ])
    const count = await writeMemberDailyScores('league-1', '2026-04-14')
    expect(count).toBe(1)
    // goals:1*2.0=2.0 + assists:1*1.5=1.5 + plusMinus:1*0.5=0.5 + shots:3*0.1=0.3 = 4.3
    const call = mockPrismaForDaily.memberDailyScore.upsert.mock.calls[0][0]
    expect(Number(call.create.fpts)).toBeCloseTo(4.3)
  })

  it('skips stats for players whose team was eliminated before the game date', async () => {
    const eliminatedBefore = new Date('2026-04-13')
    mockPrismaForDaily.leagueMember.findMany.mockResolvedValue([
      {
        id: 'member-1',
        draftPicks: [
          {
            playerId: 1,
            player: {
              team: { eliminatedAt: eliminatedBefore },
              gameStats: [
                { ...MOCK_GAME_STATS_BASE, goals: 5, assists: 5 },
              ],
            },
          },
        ],
      },
    ])
    await writeMemberDailyScores('league-1', '2026-04-14')
    const call = mockPrismaForDaily.memberDailyScore.upsert.mock.calls[0][0]
    expect(Number(call.create.fpts)).toBeCloseTo(0)
  })

  it('includes stats for players whose team was eliminated on the game date itself', async () => {
    const eliminatedSameDay = new Date('2026-04-14')
    mockPrismaForDaily.leagueMember.findMany.mockResolvedValue([
      {
        id: 'member-1',
        draftPicks: [
          {
            playerId: 1,
            player: {
              team: { eliminatedAt: eliminatedSameDay },
              gameStats: [
                { ...MOCK_GAME_STATS_BASE, goals: 2 },
              ],
            },
          },
        ],
      },
    ])
    await writeMemberDailyScores('league-1', '2026-04-14')
    const call = mockPrismaForDaily.memberDailyScore.upsert.mock.calls[0][0]
    // goals: 2*2.0 = 4.0 (team eliminated same day — stats count)
    expect(Number(call.create.fpts)).toBeCloseTo(4.0)
  })
})
