import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

type StatTotals = {
  goals: number
  assists: number
  plusMinus: number
  pim: number
  shots: number
  goalieWins: number
  goalieSaves: number
  goalsAgainst: number
  shutouts: number
  hits: number
  blockedShots: number
  powerPlayGoals: number
  powerPlayPoints: number
  shorthandedGoals: number
  shorthandedPoints: number
  gameWinningGoals: number
  overtimeGoals: number
}

const ZERO_TOTALS: StatTotals = {
  goals: 0,
  assists: 0,
  plusMinus: 0,
  pim: 0,
  shots: 0,
  goalieWins: 0,
  goalieSaves: 0,
  goalsAgainst: 0,
  shutouts: 0,
  hits: 0,
  blockedShots: 0,
  powerPlayGoals: 0,
  powerPlayPoints: 0,
  shorthandedGoals: 0,
  shorthandedPoints: 0,
  gameWinningGoals: 0,
  overtimeGoals: 0,
}

const gameStatsSelect = {
  goals: true,
  assists: true,
  plusMinus: true,
  pim: true,
  shots: true,
  goalieWins: true,
  goalieSaves: true,
  goalsAgainst: true,
  shutouts: true,
  hits: true,
  blockedShots: true,
  powerPlayGoals: true,
  powerPlayPoints: true,
  shorthandedGoals: true,
  shorthandedPoints: true,
  gameWinningGoals: true,
  overtimeGoals: true,
} satisfies Prisma.PlayerGameStatsSelect

const teamSelect = {
  id: true,
  name: true,
  colorPrimary: true,
} satisfies Prisma.NhlTeamSelect

type PlayerWithIncludes = Prisma.NhlPlayerGetPayload<{
  include: {
    team: { select: typeof teamSelect }
    gameStats: { select: typeof gameStatsSelect }
  }
}>

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: leagueId } = await params

    const token = getBearerToken(request.headers.get('authorization'))
    const decoded = await verifyIdToken(token)
    const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const member = await prisma.leagueMember.findUnique({
      where: { leagueId_userId: { leagueId, userId: user.id } },
    })
    if (!member) return NextResponse.json({ error: 'Not a member of this league' }, { status: 403 })

    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      include: { scoringSettings: true },
    })
    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

    const { searchParams } = new URL(request.url)
    const mode = searchParams.get('mode') ?? 'scoring'
    const position = searchParams.get('position')
    const teamId = searchParams.get('teamId')
    const search = searchParams.get('search')

    const positionWhere: Prisma.NhlPlayerWhereInput =
      position === 'F' ? { position: { in: ['C', 'LW', 'RW'] } } :
      position === 'FD' ? { position: { in: ['C', 'LW', 'RW', 'D'] } } :
      position === 'D' ? { position: 'D' } :
      position === 'G' ? { position: 'G' } :
      {}

    const players: PlayerWithIncludes[] = await prisma.nhlPlayer.findMany({
      where: {
        isActive: true,
        team: { playoffQualified: true },
        ...positionWhere,
        ...(teamId ? { teamId } : {}),
        ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
      },
      include: {
        team: { select: teamSelect },
        gameStats: { select: gameStatsSelect },
      },
    })

    const settings = league.scoringSettings
    const s = (v: unknown) => (v != null ? Number(v) : 0)

    const ranked = players.map((player: PlayerWithIncludes) => {
      const totals = player.gameStats.reduce(
        (acc: StatTotals, g: typeof player.gameStats[number]) => {
          for (const key of Object.keys(ZERO_TOTALS) as (keyof StatTotals)[]) {
            acc[key] += (g as Record<string, number>)[key] ?? 0
          }
          return acc
        },
        { ...ZERO_TOTALS }
      )

      let proj = 0
      if (settings) {
        proj =
          s(settings.goals) * totals.goals +
          s(settings.assists) * totals.assists +
          s(settings.plusMinus) * totals.plusMinus +
          s(settings.pim) * totals.pim +
          s(settings.shots) * totals.shots +
          s(settings.goalieWins) * totals.goalieWins +
          s(settings.goalieSaves) * totals.goalieSaves +
          s(settings.goalsAgainst) * totals.goalsAgainst +
          s(settings.shutouts) * totals.shutouts +
          s(settings.hits) * totals.hits +
          s(settings.blockedShots) * totals.blockedShots +
          s(settings.powerPlayGoals) * totals.powerPlayGoals +
          s(settings.powerPlayPoints) * totals.powerPlayPoints +
          s(settings.shorthandedGoals) * totals.shorthandedGoals +
          s(settings.shorthandedPoints) * totals.shorthandedPoints +
          s(settings.gameWinningGoals) * totals.gameWinningGoals +
          s(settings.overtimeGoals) * totals.overtimeGoals
      }

      return {
        id: player.id,
        name: player.name,
        position: player.position,
        team: player.team,
        headshotUrl: player.headshotUrl,
        adp: player.adp,
        totals,
        proj: Math.round(proj * 10) / 10,
      }
    })

    const sorted = mode === 'adp'
      ? ranked.sort((a, b) => (a.adp != null ? Number(a.adp) : 9999) - (b.adp != null ? Number(b.adp) : 9999))
      : ranked.sort((a, b) => b.proj - a.proj)

    return NextResponse.json({ players: sorted })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('GET /api/leagues/[id]/draft/rankings error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
