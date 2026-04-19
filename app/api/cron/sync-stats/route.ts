import { NextRequest, NextResponse } from 'next/server'
import { syncRosters, syncGameStats, checkEliminations, recalculateScores, writeMemberDailyScores } from '@/lib/stats-service'
import { syncInjuries, type InjurySyncResult } from '@/lib/injury-service'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Sync dates: yesterday and today (UTC)
    const now = new Date()
    const yesterday = new Date(now)
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)

    const formatDate = (d: Date) => d.toISOString().split('T')[0]
    const dates = [formatDate(yesterday), formatDate(now)]

    // 1. Refresh rosters for non-eliminated teams
    const rosterResult = await syncRosters()

    // 2. Sync game stats for both dates
    const statsResults = []
    for (const date of dates) {
      const result = await syncGameStats(date)
      statsResults.push({ date, ...result })
    }

    // 3. Check for newly eliminated teams
    const newEliminations = await checkEliminations()

    // 4. Recalculate scores for all active leagues
    const activeLeagues = await prisma.league.findMany({
      where: { status: 'active' },
      select: { id: true },
    })
    for (const league of activeLeagues) {
      await recalculateScores(league.id)
    }

    // 5. Write yesterday's daily scores per member (powers YDAY columns)
    const dailyResults = []
    for (const league of activeLeagues) {
      const count = await writeMemberDailyScores(league.id, formatDate(yesterday))
      dailyResults.push({ leagueId: league.id, membersScored: count })
    }

    // 6. Refresh injury tags from ESPN feed — non-fatal if it fails.
    let injuries: InjurySyncResult | { error: string } = { error: 'skipped' }
    try {
      injuries = await syncInjuries()
    } catch (err) {
      console.error('syncInjuries failed:', err)
      injuries = { error: String(err) }
    }

    return NextResponse.json({
      success: true,
      rosters: rosterResult,
      stats: statsResults,
      eliminations: newEliminations,
      leaguesScored: activeLeagues.length,
      dailyScores: dailyResults,
      injuries,
    })
  } catch (error) {
    console.error('Cron sync-stats error:', error)
    return NextResponse.json({ error: 'Sync failed', details: String(error) }, { status: 500 })
  }
}
