import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

async function requireCommissioner(
  request: NextRequest,
  leagueId: string
): Promise<
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse }
> {
  const token = getBearerToken(request.headers.get('authorization'))
  const decoded = await verifyIdToken(token)
  const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })
  if (!user) return { ok: false, response: NextResponse.json({ error: 'User not found' }, { status: 404 }) }
  const league = await prisma.league.findUnique({ where: { id: leagueId } })
  if (!league) return { ok: false, response: NextResponse.json({ error: 'League not found' }, { status: 404 }) }
  if (league.commissionerId !== user.id) {
    return { ok: false, response: NextResponse.json({ error: 'Commissioner only' }, { status: 403 }) }
  }
  return { ok: true, userId: user.id }
}

// GET — list pending join requests (commissioner only)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: leagueId } = await params
    const auth = await requireCommissioner(request, leagueId)
    if (!auth.ok) return auth.response

    const requests = await prisma.pendingJoinRequest.findMany({
      where: { leagueId },
      include: {
        user: { select: { id: true, email: true, displayName: true, avatarUrl: true } },
        favoriteTeam: { select: { id: true, name: true, colorPrimary: true, colorSecondary: true } },
      },
      orderBy: { submittedAt: 'asc' },
    })

    return NextResponse.json({ requests, count: requests.length })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('GET /api/leagues/[id]/join-requests error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST — approve a pending request (commissioner only)
// Body: { requestId: string }
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: leagueId } = await params
    const auth = await requireCommissioner(request, leagueId)
    if (!auth.ok) return auth.response

    const body = await request.json().catch(() => ({}))
    const { requestId } = body
    if (typeof requestId !== 'string' || requestId.length === 0) {
      return NextResponse.json({ error: 'requestId is required' }, { status: 400 })
    }

    const pending = await prisma.pendingJoinRequest.findUnique({
      where: { id: requestId },
    })
    if (!pending) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    if (pending.leagueId !== leagueId) {
      return NextResponse.json({ error: 'Request does not belong to this league' }, { status: 400 })
    }

    const league = await prisma.league.findUnique({ where: { id: leagueId } })
    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
    if (league.status !== 'setup') {
      return NextResponse.json({ error: 'League is not accepting new members' }, { status: 400 })
    }

    const memberCount = await prisma.leagueMember.count({ where: { leagueId } })
    if (memberCount >= league.maxTeams) {
      return NextResponse.json({ error: 'League is full' }, { status: 400 })
    }

    const existing = await prisma.leagueMember.findUnique({
      where: { leagueId_userId: { leagueId, userId: pending.userId } },
    })
    if (existing) {
      // Clean up the stale pending row and return the existing member
      await prisma.pendingJoinRequest.delete({ where: { id: pending.id } })
      return NextResponse.json({ status: 'already_member', member: existing })
    }

    const [member] = await prisma.$transaction([
      prisma.leagueMember.create({
        data: {
          leagueId,
          userId: pending.userId,
          teamName: pending.teamName,
          teamIcon: pending.teamIcon,
          favoriteTeamId: pending.favoriteTeamId,
        },
      }),
      prisma.pendingJoinRequest.delete({ where: { id: pending.id } }),
    ])

    return NextResponse.json({ status: 'approved', member }, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('POST /api/leagues/[id]/join-requests error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
