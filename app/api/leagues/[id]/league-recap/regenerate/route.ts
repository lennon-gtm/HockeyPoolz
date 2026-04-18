import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { generateDraftDayBulletin } from '@/lib/recap-service'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: leagueId } = await params
    const token = getBearerToken(request.headers.get('authorization'))
    const decoded = await verifyIdToken(token)
    const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const league = await prisma.league.findUnique({ where: { id: leagueId } })
    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
    if (league.commissionerId !== user.id) {
      return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
    }

    // Clear any existing bulletin for today so the service can regenerate
    // (generateDraftDayBulletin is idempotent per-day and would no-op otherwise).
    const todayStr = new Date().toISOString().split('T')[0]
    const todayDate = new Date(todayStr)
    await prisma.leagueRecap.deleteMany({
      where: { leagueId, recapDate: todayDate },
    })

    await generateDraftDayBulletin(leagueId)

    const recap = await prisma.leagueRecap.findFirst({
      where: { leagueId },
      orderBy: { recapDate: 'desc' },
    })

    return NextResponse.json({ recap })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('POST /api/leagues/[id]/league-recap/regenerate error:', error)
    return NextResponse.json({ error: 'Bulletin generation failed' }, { status: 500 })
  }
}
