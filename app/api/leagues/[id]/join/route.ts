import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const token = getBearerToken(request.headers.get('authorization'))
    const decoded = await verifyIdToken(token)

    const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
    if (user.isBanned) return NextResponse.json({ error: 'Account suspended' }, { status: 403 })

    const { teamName, teamIcon, favoriteTeamId, inviteCode } = await request.json()

    const league = await prisma.league.findUnique({ where: { id } })
    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
    if (league.inviteCode !== inviteCode) return NextResponse.json({ error: 'Invalid invite code' }, { status: 403 })
    if (league.status !== 'setup') return NextResponse.json({ error: 'League is not accepting new members' }, { status: 400 })

    const memberCount = await prisma.leagueMember.count({ where: { leagueId: league.id } })
    if (memberCount >= league.maxTeams) return NextResponse.json({ error: 'League is full' }, { status: 400 })

    const existing = await prisma.leagueMember.findUnique({
      where: { leagueId_userId: { leagueId: league.id, userId: user.id } },
    })
    if (existing) return NextResponse.json({ error: 'Already a member' }, { status: 400 })

    if (!teamName || teamName.trim().length < 1) {
      return NextResponse.json({ error: 'Team name is required' }, { status: 400 })
    }

    // Commissioner bypasses approval — creates their own LeagueMember directly
    if (user.id === league.commissionerId) {
      const member = await prisma.leagueMember.create({
        data: {
          leagueId: league.id,
          userId: user.id,
          teamName: teamName.trim(),
          teamIcon: teamIcon ?? null,
          favoriteTeamId: favoriteTeamId ?? null,
        },
      })
      return NextResponse.json({ status: 'approved', member }, { status: 201 })
    }

    // Non-commissioner: create a pending request (or update the existing one)
    const pending = await prisma.pendingJoinRequest.upsert({
      where: { leagueId_userId: { leagueId: league.id, userId: user.id } },
      update: {
        teamName: teamName.trim(),
        teamIcon: teamIcon ?? null,
        favoriteTeamId: favoriteTeamId ?? null,
      },
      create: {
        leagueId: league.id,
        userId: user.id,
        teamName: teamName.trim(),
        teamIcon: teamIcon ?? null,
        favoriteTeamId: favoriteTeamId ?? null,
      },
    })
    return NextResponse.json({ status: 'pending', request: pending }, { status: 202 })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('POST /api/leagues/[id]/join error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
