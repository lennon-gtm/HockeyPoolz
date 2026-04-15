import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({
  getBearerToken: vi.fn().mockReturnValue('token'),
  verifyIdToken: vi.fn().mockResolvedValue({ uid: 'firebase-uid' }),
  AuthError: class AuthError extends Error { constructor(msg: string) { super(msg) } },
}))

const mockPrisma = {
  user: { findUnique: vi.fn() },
  leagueMember: { findUnique: vi.fn(), findMany: vi.fn() },
  scoringSettings: { findUnique: vi.fn() },
  memberDailyScore: { findMany: vi.fn() },
}
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))

function makeReq(leagueId: string) {
  return new NextRequest(`http://localhost/api/leagues/${leagueId}/standings`, {
    headers: { authorization: 'Bearer token' },
  })
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

describe('GET /api/leagues/[id]/standings — yesterdayFpts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1' })
    mockPrisma.leagueMember.findUnique.mockResolvedValue({ id: 'member-1' })
    mockPrisma.scoringSettings.findUnique.mockResolvedValue({
      goals: 2, assists: 1.5, plusMinus: 0.5, pim: 0, shots: 0.1,
      hits: 0, blockedShots: 0, powerPlayGoals: 0.5, powerPlayPoints: 0,
      shorthandedGoals: 0, shorthandedPoints: 0, gameWinningGoals: 1,
      overtimeGoals: 1, goalieWins: 3, goalieSaves: 0.2, shutouts: 5, goalsAgainst: 0,
    })
    mockPrisma.leagueMember.findMany.mockResolvedValue([
      {
        id: 'member-1', teamName: 'Team A', teamIcon: null, totalScore: '100.0',
        scoreLastCalculatedAt: null,
        user: { displayName: 'Alice' },
        favoriteTeam: { colorPrimary: '#FF0000' },
        draftPicks: [],
      },
    ])
    mockPrisma.memberDailyScore.findMany.mockResolvedValue([
      { memberId: 'member-1', fpts: '12.5' },
    ])
  })

  it('includes yesterdayFpts in each standing entry', async () => {
    const { GET } = await import('../../app/api/leagues/[id]/standings/route')
    const res = await GET(makeReq('league-1'), ctx('league-1'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.standings[0].yesterdayFpts).toBeCloseTo(12.5)
  })

  it('returns null yesterdayFpts when no daily score row exists', async () => {
    mockPrisma.memberDailyScore.findMany.mockResolvedValue([])
    const { GET } = await import('../../app/api/leagues/[id]/standings/route')
    const res = await GET(makeReq('league-1'), ctx('league-1'))
    const body = await res.json()
    expect(body.standings[0].yesterdayFpts).toBeNull()
  })
})
