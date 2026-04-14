import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateLeagueRecaps } from '@/lib/recap-service'

export async function POST(request: NextRequest) {
  // Verify cron secret
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

    const results = []
    for (const league of activeLeagues) {
      const result = await generateLeagueRecaps(league.id)
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
