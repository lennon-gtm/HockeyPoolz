import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // League detail is public for invite preview — no auth required
    const { id } = await params
    const league = await prisma.league.findUnique({
      where: { id },
      include: {
        commissioner: { select: { displayName: true, avatarUrl: true } },
        connSmytheWinner: { select: { id: true, name: true } },
        members: {
          include: {
            user: { select: { id: true, displayName: true, avatarUrl: true } },
            favoriteTeam: { select: { colorPrimary: true, colorSecondary: true, name: true } },
          },
        },
        scoringSettings: true,
      },
    })
    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
    return NextResponse.json({ league })
  } catch (error) {
    console.error('GET /api/leagues/[id] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** DELETE /api/leagues/[id] — commissioner-only, cascades all dependent rows. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const token = getBearerToken(request.headers.get('authorization'))
    const decoded = await verifyIdToken(token)

    const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const league = await prisma.league.findUnique({ where: { id } })
    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
    if (league.commissionerId !== user.id) {
      return NextResponse.json({ error: 'Only the commissioner can delete the league' }, { status: 403 })
    }

    // Cascade order: leaf rows first, then parents. Schema has no FK cascades.
    await prisma.$transaction([
      prisma.memberDailyScore.deleteMany({ where: { member: { leagueId: id } } }),
      prisma.autodraftWishlist.deleteMany({ where: { leagueMember: { leagueId: id } } }),
      prisma.draftPick.deleteMany({ where: { leagueMember: { leagueId: id } } }),
      prisma.recap.deleteMany({ where: { leagueId: id } }),
      prisma.leagueRecap.deleteMany({ where: { leagueId: id } }),
      prisma.leagueGameSummary.deleteMany({ where: { leagueId: id } }),
      prisma.pendingJoinRequest.deleteMany({ where: { leagueId: id } }),
      prisma.draft.deleteMany({ where: { leagueId: id } }),
      prisma.scoringSettings.deleteMany({ where: { leagueId: id } }),
      prisma.leagueMember.deleteMany({ where: { leagueId: id } }),
      prisma.league.delete({ where: { id } }),
    ])

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('DELETE /api/leagues/[id] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** PATCH /api/leagues/[id] — commissioner-only updates (e.g. connSmytheWinnerId) */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const token = getBearerToken(request.headers.get('authorization'))
    const decoded = await verifyIdToken(token)

    const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const league = await prisma.league.findUnique({ where: { id } })
    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
    if (league.commissionerId !== user.id) {
      return NextResponse.json({ error: 'Only the commissioner can update the league' }, { status: 403 })
    }

    const body = await request.json()
    const updates: Record<string, number | null> = {}

    if ('connSmytheWinnerId' in body) {
      const val = body.connSmytheWinnerId
      updates.connSmytheWinnerId = val === null ? null : Number(val)
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields provided' }, { status: 400 })
    }

    const updated = await prisma.league.update({ where: { id }, data: updates })
    return NextResponse.json({ league: updated })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('PATCH /api/leagues/[id] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
