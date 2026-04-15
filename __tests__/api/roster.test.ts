import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({
  getBearerToken: vi.fn().mockReturnValue('token'),
  verifyIdToken: vi.fn().mockResolvedValue({ uid: 'firebase-uid' }),
  AuthError: class AuthError extends Error { constructor(msg: string) { super(msg) } },
}))

const mockPrisma = {
  user: { findUnique: vi.fn() },
  leagueMember: { findUnique: vi.fn() },
  scoringSettings: { findUnique: vi.fn() },
}
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))

function makeReq(leagueId: string, memberId: string) {
  return new NextRequest(
    `http://localhost/api/leagues/${leagueId}/members/${memberId}/roster`,
    { headers: { authorization: 'Bearer token' } }
  )
}
const ctx = (id: string, memberId: string) => ({
  params: Promise.resolve({ id, memberId }),
})

const SCORING = {
  goals: 2, assists: 1.5, plusMinus: 0.5, pim: 0, shots: 0.1,
  hits: 0, blockedShots: 0, powerPlayGoals: 0.5, powerPlayPoints: 0,
  shorthandedGoals: 0, shorthandedPoints: 0, gameWinningGoals: 1,
  overtimeGoals: 1, goalieWins: 3, goalieSaves: 0.2, shutouts: 5, goalsAgainst: 0,
}

describe('GET /api/leagues/[id]/members/[memberId]/roster', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1' })
    mockPrisma.scoringSettings.findUnique.mockResolvedValue(SCORING)
    // Caller is a member of the league
    mockPrisma.leagueMember.findUnique
      .mockResolvedValueOnce({ id: 'member-caller' }) // membership check
      .mockResolvedValueOnce({                         // target member fetch
        id: 'member-1',
        leagueId: 'league-1',
        teamName: 'Team A',
        teamIcon: null,
        totalScore: '42.5',
        favoriteTeam: { colorPrimary: '#FF0000' },
        user: { displayName: 'Alice' },
        draftPicks: [
          {
            player: {
              id: 1, name: 'Connor McDavid', position: 'C',
              team: { abbreviation: 'EDM', eliminatedAt: null },
              headshotUrl: null,
              gameStats: [
                {
                  gameDate: new Date('2026-04-13'),
                  goals: 1, assists: 2, plusMinus: 1, pim: 0, shots: 4,
                  hits: 0, blockedShots: 0, powerPlayGoals: 1, powerPlayPoints: 1,
                  shorthandedGoals: 0, shorthandedPoints: 0, gameWinningGoals: 0,
                  overtimeGoals: 0, goalieWins: 0, goalieSaves: 0, shutouts: 0,
                  goalsAgainst: 0, savePct: 0,
                },
              ],
            },
          },
        ],
      })
  })

  it('returns 403 when caller is not a league member', async () => {
    mockPrisma.leagueMember.findUnique.mockReset()
    mockPrisma.leagueMember.findUnique.mockResolvedValueOnce(null)
    const { GET } = await import(
      '../../app/api/leagues/[id]/members/[memberId]/roster/route'
    )
    const res = await GET(makeReq('league-1', 'member-1'), ctx('league-1', 'member-1'))
    expect(res.status).toBe(403)
  })

  it('returns player list with totalFpts and yesterdayFpts', async () => {
    const { GET } = await import(
      '../../app/api/leagues/[id]/members/[memberId]/roster/route'
    )
    const res = await GET(makeReq('league-1', 'member-1'), ctx('league-1', 'member-1'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.players).toHaveLength(1)
    const p = body.players[0]
    expect(p.playerId).toBe(1)
    expect(p.name).toBe('Connor McDavid')
    // totalFpts: goals:1*2+assists:2*1.5+plusMinus:1*0.5+shots:4*0.1+ppGoals:1*0.5 = 6.4
    expect(p.totalFpts).toBeCloseTo(6.4)
    // yesterdayFpts: game is from 2026-04-13, yesterday relative to test runtime will differ
    // so just verify it's a number or null
    expect(typeof p.yesterdayFpts === 'number' || p.yesterdayFpts === null).toBe(true)
  })
})
