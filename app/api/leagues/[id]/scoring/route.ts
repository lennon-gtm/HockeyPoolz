import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const settings = await prisma.scoringSettings.findUnique({ where: { leagueId: id } })
    if (!settings) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ settings })
  } catch (error) {
    console.error('GET /api/leagues/[id]/scoring error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const token = getBearerToken(request.headers.get('authorization'))
    const decoded = await verifyIdToken(token)

    const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const league = await prisma.league.findUnique({ where: { id } })
    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
    if (league.commissionerId !== user.id) {
      return NextResponse.json({ error: 'Only the commissioner can update scoring settings' }, { status: 403 })
    }
    // TEMP: block lifted so commissioner can correct BCHL scoring — restore after.

    const body = await request.json()
    const allowedFields = [
      'goals', 'assists', 'plusMinus', 'pim', 'shots',
      'goalieWins', 'goalieSaves', 'shutouts',
      'hits', 'blockedShots', 'powerPlayGoals', 'powerPlayPoints', 'powerPlayAssists',
      'shorthandedGoals', 'shorthandedPoints', 'shorthandedAssists',
      'gameWinningGoals', 'overtimeGoals', 'overtimeAssists',
      'connSmytheTrophy', 'goalsAgainst',
    ]
    const updates: Record<string, number> = {}

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        const val = Number(body[field])
        if (isNaN(val) || val < 0 || val > 100) {
          return NextResponse.json({ error: `Invalid value for ${field}` }, { status: 400 })
        }
        updates[field] = val
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields provided' }, { status: 400 })
    }

    const settings = await prisma.scoringSettings.upsert({
      where: { leagueId: id },
      update: updates,
      create: { leagueId: id, ...updates },
    })

    return NextResponse.json({ settings })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('PUT /api/leagues/[id]/scoring error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
