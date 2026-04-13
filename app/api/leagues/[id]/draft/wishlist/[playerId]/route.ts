import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; playerId: string }> }
) {
  try {
    const { id: leagueId, playerId: playerIdStr } = await params
    const playerId = parseInt(playerIdStr, 10)
    if (isNaN(playerId)) return NextResponse.json({ error: 'Invalid playerId' }, { status: 400 })

    const token = getBearerToken(request.headers.get('authorization'))
    const decoded = await verifyIdToken(token)
    const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const member = await prisma.leagueMember.findUnique({
      where: { leagueId_userId: { leagueId, userId: user.id } },
    })
    if (!member) return NextResponse.json({ error: 'Not a member' }, { status: 403 })

    await prisma.autodraftWishlist.delete({
      where: { leagueMemberId_playerId: { leagueMemberId: member.id, playerId } },
    })

    // Re-rank remaining entries
    const remaining = await prisma.autodraftWishlist.findMany({
      where: { leagueMemberId: member.id },
      orderBy: { rank: 'asc' },
    })
    await prisma.$transaction(
      remaining.map((entry, index) =>
        prisma.autodraftWishlist.update({ where: { id: entry.id }, data: { rank: index + 1 } })
      )
    )

    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
