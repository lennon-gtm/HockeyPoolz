import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { syncGameStats, recalculateScores } from '@/lib/stats-service'

/**
 * POST /api/leagues/[id]/sync-today — member-triggered focused sync.
 *
 * Pulls box scores for TODAY's playoff games only (LIVE + completed) and
 * recalculates this league's scores. Skips rosters, yesterday's games,
 * injuries, eliminations, other leagues — purposely narrow so any member
 * can run it mid-game without hammering NHL or blowing the function budget.
 *
 * Extended game-log stats are fetched only for players drafted in *this*
 * league who actually played today (tens of calls, not hundreds).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const token = getBearerToken(request.headers.get('authorization'))
    const decoded = await verifyIdToken(token)

    const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const member = await prisma.leagueMember.findUnique({
      where: { leagueId_userId: { leagueId: id, userId: user.id } },
    })
    if (!member) return NextResponse.json({ error: 'Not a league member' }, { status: 403 })

    const today = new Date().toISOString().split('T')[0]
    const syncResult = await syncGameStats(today, { includeLive: true, scopedToLeagueId: id })
    await recalculateScores(id)

    return NextResponse.json({
      success: true,
      date: today,
      ...syncResult,
    })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('POST /api/leagues/[id]/sync-today error:', error)
    return NextResponse.json({ error: 'Sync failed', details: String(error) }, { status: 500 })
  }
}
