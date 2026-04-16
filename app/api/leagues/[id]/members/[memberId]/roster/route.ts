import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { calculatePlayerScore, type ScoringWeights } from '@/lib/stats-service'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  try {
    const { id, memberId } = await params
    const token = getBearerToken(request.headers.get('authorization'))
    const decoded = await verifyIdToken(token)

    const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    // Caller must be a member of this league
    const callerMembership = await prisma.leagueMember.findUnique({
      where: { leagueId_userId: { leagueId: id, userId: user.id } },
    })
    if (!callerMembership) {
      return NextResponse.json({ error: 'Not a league member' }, { status: 403 })
    }

    const settings = await prisma.scoringSettings.findUnique({ where: { leagueId: id } })
    if (!settings) return NextResponse.json({ error: 'Scoring settings not found' }, { status: 404 })

    const weights: ScoringWeights = {
      goals: Number(settings.goals), assists: Number(settings.assists),
      plusMinus: Number(settings.plusMinus), pim: Number(settings.pim),
      shots: Number(settings.shots), hits: Number(settings.hits),
      blockedShots: Number(settings.blockedShots),
      powerPlayGoals: Number(settings.powerPlayGoals),
      powerPlayPoints: Number(settings.powerPlayPoints),
      powerPlayAssists: Number(settings.powerPlayAssists),
      shorthandedGoals: Number(settings.shorthandedGoals),
      shorthandedPoints: Number(settings.shorthandedPoints),
      shorthandedAssists: Number(settings.shorthandedAssists),
      gameWinningGoals: Number(settings.gameWinningGoals),
      overtimeGoals: Number(settings.overtimeGoals),
      overtimeAssists: Number(settings.overtimeAssists),
      goalieWins: Number(settings.goalieWins), goalieSaves: Number(settings.goalieSaves),
      shutouts: Number(settings.shutouts), goalsAgainst: Number(settings.goalsAgainst),
    }

    const member = await prisma.leagueMember.findUnique({
      where: { id: memberId },
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
    })
    if (!member || member.leagueId !== id) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    // Yesterday at UTC midnight (for YDAY column)
    const yd = new Date()
    yd.setUTCDate(yd.getUTCDate() - 1)
    yd.setUTCHours(0, 0, 0, 0)
    const ydStr = yd.toISOString().split('T')[0]

    const players = member.draftPicks.map(pick => {
      const { player } = pick
      const isEliminated = player.team.eliminatedAt !== null
      const eligibleStats = player.gameStats.filter(gs =>
        !player.team.eliminatedAt || gs.gameDate <= player.team.eliminatedAt
      )

      // Season totals
      let totalFpts = 0
      const agg = {
        goals: 0, assists: 0, plusMinus: 0, pim: 0,
        powerPlayGoals: 0, powerPlayPoints: 0,
        shorthandedGoals: 0, gameWinningGoals: 0,
        goalieWins: 0, goalieSaves: 0, shutouts: 0, goalsAgainst: 0,
        savePctNumerator: 0, savePctDenominator: 0,
      }
      for (const gs of eligibleStats) {
        totalFpts += calculatePlayerScore({
          goals: gs.goals, assists: gs.assists, plusMinus: gs.plusMinus,
          pim: gs.pim, shots: gs.shots, hits: gs.hits,
          blockedShots: gs.blockedShots, powerPlayGoals: gs.powerPlayGoals,
          powerPlayPoints: gs.powerPlayPoints,
          powerPlayAssists: gs.powerPlayPoints - gs.powerPlayGoals,
          shorthandedGoals: gs.shorthandedGoals,
          shorthandedPoints: gs.shorthandedPoints,
          shorthandedAssists: gs.shorthandedPoints - gs.shorthandedGoals,
          gameWinningGoals: gs.gameWinningGoals,
          overtimeGoals: gs.overtimeGoals,
          overtimeAssists: gs.overtimeAssists,
          goalieWins: gs.goalieWins,
          goalieSaves: gs.goalieSaves, shutouts: gs.shutouts,
          goalsAgainst: gs.goalsAgainst,
        }, weights)
        agg.goals += gs.goals
        agg.assists += gs.assists
        agg.plusMinus += gs.plusMinus
        agg.pim += gs.pim
        agg.powerPlayGoals += gs.powerPlayGoals
        agg.powerPlayPoints += gs.powerPlayPoints
        agg.shorthandedGoals += gs.shorthandedGoals
        agg.gameWinningGoals += gs.gameWinningGoals
        agg.goalieWins += gs.goalieWins
        agg.goalieSaves += gs.goalieSaves
        agg.shutouts += gs.shutouts
        agg.goalsAgainst += gs.goalsAgainst
        agg.savePctNumerator += gs.goalieSaves
        agg.savePctDenominator += gs.goalieSaves + gs.goalsAgainst
      }

      const seasonSavePct = agg.savePctDenominator > 0
        ? agg.savePctNumerator / agg.savePctDenominator
        : 0

      // Yesterday FPTS (game date matching yesterday's UTC date)
      const ydStats = player.gameStats.filter(gs =>
        gs.gameDate.toISOString().startsWith(ydStr) &&
        (!player.team.eliminatedAt || gs.gameDate <= player.team.eliminatedAt)
      )
      const yesterdayFpts = ydStats.length > 0
        ? ydStats.reduce((sum, gs) => sum + calculatePlayerScore({
            goals: gs.goals, assists: gs.assists, plusMinus: gs.plusMinus,
            pim: gs.pim, shots: gs.shots, hits: gs.hits,
            blockedShots: gs.blockedShots, powerPlayGoals: gs.powerPlayGoals,
            powerPlayPoints: gs.powerPlayPoints,
            powerPlayAssists: gs.powerPlayPoints - gs.powerPlayGoals,
            shorthandedGoals: gs.shorthandedGoals,
            shorthandedPoints: gs.shorthandedPoints,
            shorthandedAssists: gs.shorthandedPoints - gs.shorthandedGoals,
            gameWinningGoals: gs.gameWinningGoals,
            overtimeGoals: gs.overtimeGoals, overtimeAssists: gs.overtimeAssists,
            goalieWins: gs.goalieWins,
            goalieSaves: gs.goalieSaves, shutouts: gs.shutouts,
            goalsAgainst: gs.goalsAgainst,
          }, weights), 0)
        : null

      return {
        playerId: player.id,
        name: player.name,
        position: player.position,
        nhlTeamAbbrev: player.team.abbreviation,
        headshotUrl: player.headshotUrl,
        isEliminated,
        totalFpts: Math.round(totalFpts * 100) / 100,
        yesterdayFpts: yesterdayFpts !== null ? Math.round(yesterdayFpts * 100) / 100 : null,
        // Season aggregates
        goals: agg.goals,
        assists: agg.assists,
        pts: agg.goals + agg.assists,
        plusMinus: agg.plusMinus,
        pim: agg.pim,
        powerPlayGoals: agg.powerPlayGoals,
        powerPlayAssists: agg.powerPlayPoints - agg.powerPlayGoals,
        shorthandedGoals: agg.shorthandedGoals,
        gameWinningGoals: agg.gameWinningGoals,
        // Goalie aggregates
        goalieWins: agg.goalieWins,
        goalieSaves: agg.goalieSaves,
        shutouts: agg.shutouts,
        goalsAgainst: agg.goalsAgainst,
        seasonSavePct: Math.round(seasonSavePct * 1000) / 1000,
      }
    })

    return NextResponse.json({
      member: {
        id: member.id,
        teamName: member.teamName,
        teamIcon: member.teamIcon,
        totalScore: Number(member.totalScore),
        colorPrimary: member.favoriteTeam?.colorPrimary ?? null,
        userName: member.user.displayName,
      },
      players,
      myMemberId: callerMembership.id,
    })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('GET /api/leagues/[id]/members/[memberId]/roster error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
