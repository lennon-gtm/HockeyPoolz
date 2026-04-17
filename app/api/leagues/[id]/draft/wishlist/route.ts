import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: leagueId } = await params
    const token = getBearerToken(request.headers.get('authorization'))
    const decoded = await verifyIdToken(token)
    const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const member = await prisma.leagueMember.findUnique({
      where: { leagueId_userId: { leagueId, userId: user.id } },
    })
    if (!member) return NextResponse.json({ error: 'Not a member' }, { status: 403 })

    const wishlist = await prisma.autodraftWishlist.findMany({
      where: { leagueMemberId: member.id },
      include: { player: { select: { id: true, name: true, position: true, teamId: true, headshotUrl: true, injuryStatus: true } } },
      orderBy: { rank: 'asc' },
    })

    return NextResponse.json({ wishlist })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

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

    const member = await prisma.leagueMember.findUnique({
      where: { leagueId_userId: { leagueId, userId: user.id } },
    })
    if (!member) return NextResponse.json({ error: 'Not a member' }, { status: 403 })

    const body = await request.json()
    const { playerId } = body
    if (typeof playerId !== 'number') return NextResponse.json({ error: 'playerId required' }, { status: 400 })

    const player = await prisma.nhlPlayer.findUnique({ where: { id: playerId } })
    if (!player) return NextResponse.json({ error: 'Player not found' }, { status: 404 })

    // Add to end of wishlist
    const last = await prisma.autodraftWishlist.findFirst({
      where: { leagueMemberId: member.id },
      orderBy: { rank: 'desc' },
    })
    const rank = (last?.rank ?? 0) + 1

    const entry = await prisma.autodraftWishlist.create({
      data: { leagueMemberId: member.id, playerId, rank },
      include: { player: { select: { id: true, name: true, position: true, teamId: true, headshotUrl: true, injuryStatus: true } } },
    })

    return NextResponse.json({ entry }, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    if ((error as { code?: string }).code === 'P2002') return NextResponse.json({ error: 'Player already in wishlist' }, { status: 409 })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /wishlist — reorder the full wishlist
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: leagueId } = await params
    const token = getBearerToken(request.headers.get('authorization'))
    const decoded = await verifyIdToken(token)
    const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const member = await prisma.leagueMember.findUnique({
      where: { leagueId_userId: { leagueId, userId: user.id } },
    })
    if (!member) return NextResponse.json({ error: 'Not a member' }, { status: 403 })

    const body = await request.json()
    const { playerIds } = body
    if (!Array.isArray(playerIds)) return NextResponse.json({ error: 'playerIds array required' }, { status: 400 })

    await prisma.$transaction(
      playerIds.map((id: number, index: number) =>
        prisma.autodraftWishlist.update({
          where: { leagueMemberId_playerId: { leagueMemberId: member.id, playerId: id } },
          data: { rank: index + 1 },
        })
      )
    )

    const wishlist = await prisma.autodraftWishlist.findMany({
      where: { leagueMemberId: member.id },
      include: { player: { select: { id: true, name: true, position: true, teamId: true, headshotUrl: true, injuryStatus: true } } },
      orderBy: { rank: 'asc' },
    })

    return NextResponse.json({ wishlist })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
