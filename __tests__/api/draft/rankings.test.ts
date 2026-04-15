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
  league: { findUnique: vi.fn() },
  nhlPlayer: { findMany: vi.fn() },
}
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))

function makeReq(leagueId: string, qs = '') {
  return new NextRequest(
    `http://localhost/api/leagues/${leagueId}/draft/rankings${qs}`,
    { headers: { authorization: 'Bearer token' } }
  )
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

describe('GET /api/leagues/[id]/draft/rankings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', isBanned: false })
    mockPrisma.leagueMember.findUnique.mockResolvedValue({ id: 'member-1' })
    mockPrisma.league.findUnique.mockResolvedValue({
      id: 'league-1',
      scoringSettings: {
        goals: 2, assists: 1.5, plusMinus: 0.5, shots: 0.1,
        pim: 0, goalieWins: 3, goalieSaves: 0.2, shutouts: 5,
      },
    })
    mockPrisma.nhlPlayer.findMany.mockResolvedValue([
      {
        id: 1, name: 'Connor McDavid', position: 'C', adp: 1.2, headshotUrl: null,
        team: { id: 'EDM', name: 'Edmonton Oilers', colorPrimary: '#FF4C00' },
        gameStats: [
          { goals: 10, assists: 20, plusMinus: 5, pim: 4, shots: 50,
            goalieWins: 0, goalieSaves: 0, goalsAgainst: 0, shutouts: 0,
            hits: 0, blockedShots: 0, powerPlayGoals: 0, powerPlayPoints: 0,
            shorthandedGoals: 0, shorthandedPoints: 0, gameWinningGoals: 0, overtimeGoals: 0 },
        ],
      },
      {
        id: 2, name: 'Leon Draisaitl', position: 'C', adp: 2.0, headshotUrl: null,
        team: { id: 'EDM', name: 'Edmonton Oilers', colorPrimary: '#FF4C00' },
        gameStats: [
          { goals: 8, assists: 15, plusMinus: 3, pim: 2, shots: 40,
            goalieWins: 0, goalieSaves: 0, goalsAgainst: 0, shutouts: 0,
            hits: 0, blockedShots: 0, powerPlayGoals: 0, powerPlayPoints: 0,
            shorthandedGoals: 0, shorthandedPoints: 0, gameWinningGoals: 0, overtimeGoals: 0 },
        ],
      },
    ])
  })

  it('returns 401 when auth fails', async () => {
    const { verifyIdToken } = await import('@/lib/auth')
    vi.mocked(verifyIdToken).mockRejectedValueOnce(new Error('bad token'))
    const { GET } = await import('@/app/api/leagues/[id]/draft/rankings/route')
    const res = await GET(makeReq('league-1'), ctx('league-1'))
    expect(res.status).toBe(401)
  })

  it('returns 403 when not a league member', async () => {
    mockPrisma.leagueMember.findUnique.mockResolvedValue(null)
    const { GET } = await import('@/app/api/leagues/[id]/draft/rankings/route')
    const res = await GET(makeReq('league-1'), ctx('league-1'))
    expect(res.status).toBe(403)
  })

  it('returns players sorted by PROJ descending in scoring mode', async () => {
    const { GET } = await import('@/app/api/leagues/[id]/draft/rankings/route')
    const res = await GET(makeReq('league-1'), ctx('league-1'))
    const data = await res.json()
    expect(res.status).toBe(200)
    // McDavid: 10*2 + 20*1.5 + 5*0.5 + 50*0.1 = 57.5
    // Draisaitl: 8*2 + 15*1.5 + 3*0.5 + 40*0.1 = 44.0
    expect(data.players[0].name).toBe('Connor McDavid')
    expect(data.players[0].proj).toBe(57.5)
    expect(data.players[1].proj).toBe(44.0)
  })

  it('returns players sorted by ADP ascending in adp mode', async () => {
    const { GET } = await import('@/app/api/leagues/[id]/draft/rankings/route')
    const res = await GET(makeReq('league-1', '?mode=adp'), ctx('league-1'))
    const data = await res.json()
    expect(data.players[0].adp).toBe(1.2)
    expect(data.players[1].adp).toBe(2.0)
  })

  it('passes position filter F as { in: [C, LW, RW] } to Prisma', async () => {
    const { GET } = await import('@/app/api/leagues/[id]/draft/rankings/route')
    await GET(makeReq('league-1', '?position=F'), ctx('league-1'))
    expect(mockPrisma.nhlPlayer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ position: { in: ['C', 'LW', 'RW'] } }),
      })
    )
  })
})
