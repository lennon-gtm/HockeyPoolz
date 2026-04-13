import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { calculatePlayerScore, type ScoringWeights } from '@/lib/stats-service'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; playerId: string }> }
) {
  try {
    const { id, playerId } = await params
    const token = getBearerToken(request.headers.get('authorization'))
    const decoded = await verifyIdToken(token)

    const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const membership = await prisma.leagueMember.findUnique({
      where: { leagueId_userId: { leagueId: id, userId: user.id } },
    })
    if (!membership) return NextResponse.json({ error: 'Not a league member' }, { status: 403 })

    const playerIdNum = parseInt(playerId, 10)
    if (isNaN(playerIdNum)) return NextResponse.json({ error: 'Invalid player ID' }, { status: 400 })

    const player = await prisma.nhlPlayer.findUnique({
      where: { id: playerIdNum },
      include: {
        team: { select: { id: true, abbreviation: true, name: true, eliminatedAt: true } },
        gameStats: { orderBy: { gameDate: 'desc' } },
      },
    })
    if (!player) return NextResponse.json({ error: 'Player not found' }, { status: 404 })

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

    const eligibleStats = player.gameStats.filter(gs =>
      !player.team.eliminatedAt || gs.gameDate <= player.team.eliminatedAt
    )

    // Build totals
    const statFields = [
      'goals', 'assists', 'plusMinus', 'pim', 'shots', 'hits', 'blockedShots',
      'powerPlayGoals', 'powerPlayPoints', 'shorthandedGoals', 'shorthandedPoints',
      'gameWinningGoals', 'overtimeGoals', 'goalieWins', 'goalieSaves', 'shutouts', 'goalsAgainst',
    ] as const
    const totals: Record<string, number> = {}
    for (const field of statFields) {
      totals[field] = eligibleStats.reduce((sum, gs) => sum + (gs[field] as number ?? 0), 0)
    }

    const weightedTotal = eligibleStats.reduce((sum, gs) => {
      const gameStats = {
        goals: gs.goals, assists: gs.assists, plusMinus: gs.plusMinus,
        pim: gs.pim, shots: gs.shots, hits: gs.hits,
        blockedShots: gs.blockedShots, powerPlayGoals: gs.powerPlayGoals,
        powerPlayPoints: gs.powerPlayPoints, shorthandedGoals: gs.shorthandedGoals,
        shorthandedPoints: gs.shorthandedPoints, gameWinningGoals: gs.gameWinningGoals,
        overtimeGoals: gs.overtimeGoals, goalieWins: gs.goalieWins,
        goalieSaves: gs.goalieSaves, shutouts: gs.shutouts,
        goalsAgainst: gs.goalsAgainst,
      }
      return sum + calculatePlayerScore(gameStats, weights)
    }, 0)

    const gameLog = eligibleStats.map(gs => {
      const gameStats = {
        goals: gs.goals, assists: gs.assists, plusMinus: gs.plusMinus,
        pim: gs.pim, shots: gs.shots, hits: gs.hits,
        blockedShots: gs.blockedShots, powerPlayGoals: gs.powerPlayGoals,
        powerPlayPoints: gs.powerPlayPoints, shorthandedGoals: gs.shorthandedGoals,
        shorthandedPoints: gs.shorthandedPoints, gameWinningGoals: gs.gameWinningGoals,
        overtimeGoals: gs.overtimeGoals, goalieWins: gs.goalieWins,
        goalieSaves: gs.goalieSaves, shutouts: gs.shutouts,
        goalsAgainst: gs.goalsAgainst,
      }
      return {
        gameId: gs.gameId,
        gameDate: gs.gameDate.toISOString().split('T')[0],
        stats: gameStats,
        weightedScore: Math.round(calculatePlayerScore(gameStats, weights) * 100) / 100,
      }
    })

    return NextResponse.json({
      player: {
        id: player.id,
        name: player.name,
        position: player.position,
        team: {
          abbreviation: player.team.abbreviation,
          name: player.team.name,
          isEliminated: player.team.eliminatedAt !== null,
        },
        headshotUrl: player.headshotUrl,
        totals: { ...totals, weightedTotal: Math.round(weightedTotal * 100) / 100 },
        gameLog,
      },
    })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('GET /api/leagues/[id]/players/[playerId] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
