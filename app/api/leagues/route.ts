import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { nanoid } from 'nanoid'

export async function POST(request: NextRequest) {
  try {
    const token = getBearerToken(request.headers.get('authorization'))
    const decoded = await verifyIdToken(token)

    const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
    if (user.isBanned) return NextResponse.json({ error: 'Account suspended' }, { status: 403 })

    const body = await request.json()
    const { name, maxTeams, playersPerTeam } = body

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return NextResponse.json({ error: 'League name must be at least 2 characters' }, { status: 400 })
    }
    if (!maxTeams || typeof maxTeams !== 'number' || maxTeams < 2 || maxTeams > 20) {
      return NextResponse.json({ error: 'Max teams must be between 2 and 20' }, { status: 400 })
    }
    if (!playersPerTeam || typeof playersPerTeam !== 'number' || playersPerTeam < 4 || playersPerTeam > 20) {
      return NextResponse.json({ error: 'Players per team must be between 4 and 20' }, { status: 400 })
    }

    const league = await prisma.league.create({
      data: {
        commissionerId: user.id,
        name: name.trim(),
        inviteCode: nanoid(8),
        maxTeams,
        playersPerTeam,
        scoringSettings: {
          create: {}, // creates with all defaults from schema
        },
      },
      include: { scoringSettings: true },
    })

    // Commissioner auto-joins as first member
    await prisma.leagueMember.create({
      data: {
        leagueId: league.id,
        userId: user.id,
        teamName: user.displayName,
        teamIcon: user.avatarUrl,
      },
    })

    return NextResponse.json({ league }, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('POST /api/leagues error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const token = getBearerToken(request.headers.get('authorization'))
    const decoded = await verifyIdToken(token)
    const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const members = await prisma.leagueMember.findMany({
      where: { userId: user.id },
      include: {
        league: {
          include: { members: { select: { id: true } } },
        },
      },
      orderBy: { joinedAt: 'desc' },
    })

    const leagues = members.map(m => m.league)
    return NextResponse.json({ leagues })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('GET /api/leagues error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
