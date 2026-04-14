import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const token = getBearerToken(request.headers.get('authorization'))
    const decoded = await verifyIdToken(token)

    const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const membership = await prisma.leagueMember.findUnique({
      where: { leagueId_userId: { leagueId: id, userId: user.id } },
    })
    if (!membership) return NextResponse.json({ error: 'Not a league member' }, { status: 403 })

    const body = await request.json()
    const updates: Record<string, string | null> = {}

    if (body.teamName !== undefined) {
      const name = String(body.teamName).trim()
      if (name.length < 1) return NextResponse.json({ error: 'Team name is required' }, { status: 400 })
      updates.teamName = name
    }

    if (body.teamIcon !== undefined) {
      updates.teamIcon = body.teamIcon ?? null
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields provided' }, { status: 400 })
    }

    const updated = await prisma.leagueMember.update({
      where: { id: membership.id },
      data: updates,
    })

    return NextResponse.json({ member: updated })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('PATCH /api/leagues/[id]/members/me error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
