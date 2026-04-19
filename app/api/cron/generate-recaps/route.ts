import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateLeagueRecaps, generateLeagueRecap } from '@/lib/recap-service'
import { generateLeagueScoreSummaries } from '@/lib/scores-service'

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const force = new URL(request.url).searchParams.get('force') === 'true'

  try {
    const activeLeagues = await prisma.league.findMany({
      where: { status: 'active' },
      select: { id: true, name: true },
    })

    const todayDate = new Date(new Date().toISOString().split('T')[0])
    const yesterday = new Date()
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    const yesterdayStr = yesterday.toISOString().split('T')[0]
    const yesterdayDate = new Date(yesterdayStr)

    const results = []
    for (const league of activeLeagues) {
      // With ?force=true, delete today's existing recaps so the generators
      // don't short-circuit on their dedup checks. Use when an earlier run
      // produced stale content (e.g. stats hadn't synced yet).
      if (force) {
        await prisma.leagueRecap.deleteMany({
          where: { leagueId: league.id, recapDate: todayDate },
        })
        await prisma.recap.deleteMany({
          where: { leagueId: league.id, recapDate: todayDate },
        })
        await prisma.leagueGameSummary.deleteMany({
          where: { leagueId: league.id, gameDate: yesterdayDate },
        })
      }

      const result = await generateLeagueRecaps(league.id)
      // Generate league-wide bulletin after per-member recaps
      try {
        await generateLeagueRecap(league.id)
      } catch (err) {
        result.errors.push(`League recap failed: ${err}`)
      }
      // Generate yesterday's game summaries
      try {
        await generateLeagueScoreSummaries(league.id, yesterdayStr)
      } catch (err) {
        result.errors.push(`Scores summary failed: ${err}`)
      }
      results.push({ leagueId: league.id, leagueName: league.name, ...result })
    }

    return NextResponse.json({
      success: true,
      leagues: results,
      totalRecaps: results.reduce((sum, r) => sum + r.recapsCreated, 0),
    })
  } catch (error) {
    console.error('Cron generate-recaps error:', error)
    return NextResponse.json({ error: 'Recap generation failed', details: String(error) }, { status: 500 })
  }
}
