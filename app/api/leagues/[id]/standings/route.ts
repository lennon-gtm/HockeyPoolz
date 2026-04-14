import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { calculatePlayerScore, type ScoringWeights } from '@/lib/stats-service'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const token = getBearerToken(request.headers.get('authorization'))
    const decoded = await verifyIdToken(token)

    const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    // Verify membership
    const membership = await prisma.leagueMember.findUnique({
      where: { leagueId_userId: { leagueId: id, userId: user.id } },
    })
    if (!membership) return NextResponse.json({ error: 'Not a league member' }, { status: 403 })

    const settings = await prisma.scoringSettings.findUnique({ where: { leagueId: id } })
    if (!settings) return NextResponse.json({ error: 'Scoring settings not found' }, { status: 404 })

    const weights: ScoringWeights = {
      goals: Number(settings.goals), assists: Number(settings.assists),
      plusMinus: Number(settings.plusMinus), pim: Number(settings.pim),
      shots: Number(settings.shots), hits: Number(settings.hits),
      blockedShots: Number(settings.blockedShots),
      powerPlayGoals: Number(settings.powerPlayGoals),
      powerPlayPoints: Number(settings.powerPlayPoints),
      shorthandedGoals: Number(settings.shorthandedGoals),
      shorthandedPoints: Number(settings.shorthandedPoints),
      gameWinningGoals: Number(settings.gameWinningGoals),
      overtimeGoals: Number(settings.overtimeGoals),
      goalieWins: Number(settings.goalieWins), goalieSaves: Number(settings.goalieSaves),
      shutouts: Number(settings.shutouts), goalsAgainst: Number(settings.goalsAgainst),
    }

    const members = await prisma.leagueMember.findMany({
      where: { leagueId: id },
      include: {
        user: { select: { displayName: true } },
        favoriteTeam: { select: { colorPrimary: true } },
        draftPicks: {
          include: {
            player: {
              include: {
                team: { select: { abbreviation: true, eliminatedAt: true } },
                gameStats: true,
              },
            },
          },
        },
      },
      orderBy: { totalScore: 'desc' },
    })

    const standings = members.map((member, index) => {
      const players = member.draftPicks.map(pick => {
        const isEliminated = pick.player.team.eliminatedAt !== null
        const eligibleStats = pick.player.gameStats.filter(gs =>
          !pick.player.team.eliminatedAt || gs.gameDate <= pick.player.team.eliminatedAt
        )

        // Aggregate stats across all games
        const totals: Record<string, number> = {}
        const statFields = [
          'goals', 'assists', 'plusMinus', 'pim', 'shots', 'hits', 'blockedShots',
          'powerPlayGoals', 'powerPlayPoints', 'shorthandedGoals', 'shorthandedPoints',
          'gameWinningGoals', 'overtimeGoals', 'goalieWins', 'goalieSaves', 'shutouts', 'goalsAgainst',
        ]
        for (const field of statFields) {
          totals[field] = eligibleStats.reduce((sum, gs) => sum + (gs[field as keyof typeof gs] as number ?? 0), 0)
        }

        const totalPoints = eligibleStats.reduce(
          (sum, gs) => sum + calculatePlayerScore({
            goals: gs.goals, assists: gs.assists, plusMinus: gs.plusMinus,
            pim: gs.pim, shots: gs.shots, hits: gs.hits,
            blockedShots: gs.blockedShots, powerPlayGoals: gs.powerPlayGoals,
            powerPlayPoints: gs.powerPlayPoints, shorthandedGoals: gs.shorthandedGoals,
            shorthandedPoints: gs.shorthandedPoints, gameWinningGoals: gs.gameWinningGoals,
            overtimeGoals: gs.overtimeGoals, goalieWins: gs.goalieWins,
            goalieSaves: gs.goalieSaves, shutouts: gs.shutouts,
            goalsAgainst: gs.goalsAgainst,
          }, weights),
          0
        )

        return {
          playerId: pick.player.id,
          name: pick.player.name,
          position: pick.player.position,
          teamAbbrev: pick.player.team.abbreviation,
          headshotUrl: pick.player.headshotUrl,
          totalPoints: Math.round(totalPoints * 100) / 100,
          isEliminated,
          stats: totals,
        }
      })

      return {
        rank: index + 1,
        memberId: member.id,
        teamName: member.teamName,
        teamIcon: member.teamIcon,
        userName: member.user.displayName,
        totalScore: Number(member.totalScore),
        scoreLastCalculatedAt: member.scoreLastCalculatedAt,
        colorPrimary: member.favoriteTeam?.colorPrimary ?? null,
        players,
      }
    })

    return NextResponse.json({ standings, scoringSettings: settings, myMemberId: membership.id })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('GET /api/leagues/[id]/standings error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
