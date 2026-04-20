import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateLeagueRecaps, generateLeagueRecap } from '@/lib/recap-service'
import { generateLeagueScoreSummaries } from '@/lib/scores-service'

/**
 * GET /api/cron/generate-recaps — fires daily via Vercel Cron at 4am ET.
 *
 * Each run wipes the previous day's recap artifacts for every active
 * league (per-member recaps, league bulletin, per-game score summaries)
 * and regenerates them fresh from the just-synced stats. This keeps the
 * content aligned with the latest point totals and avoids stale
 * mid-day generations lingering in the DB.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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
      // Wipe previous outputs for this league so regeneration writes
      // clean rows without having to reason about dedup/upsert behavior.
      //
      // Recap + LeagueRecap are keyed by recapDate; kill today's and
      // yesterday's rows (yesterday's catch any mid-day stale runs).
      // LeagueGameSummary is keyed by gameDate = yesterday, so kill
      // those and let the generator rewrite them with current scores.
      await prisma.recap.deleteMany({
        where: {
          leagueId: league.id,
          recapDate: { in: [yesterdayDate, todayDate] },
        },
      })
      await prisma.leagueRecap.deleteMany({
        where: {
          leagueId: league.id,
          recapDate: { in: [yesterdayDate, todayDate] },
        },
      })
      await prisma.leagueGameSummary.deleteMany({
        where: { leagueId: league.id, gameDate: yesterdayDate },
      })

      const result = await generateLeagueRecaps(league.id)
      try {
        await generateLeagueRecap(league.id)
      } catch (err) {
        result.errors.push(`League recap failed: ${err}`)
      }
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
