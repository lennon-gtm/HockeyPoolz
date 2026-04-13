import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ teamId: string }> }) {
  try {
    const { teamId } = await params
    const token = getBearerToken(request.headers.get('authorization'))
    const decoded = await verifyIdToken(token)

    const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })
    if (!user?.isPlatformAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const eliminatedAt = body.eliminatedAt ? new Date(body.eliminatedAt) : null

    const team = await prisma.nhlTeam.update({
      where: { id: teamId },
      data: { eliminatedAt },
    })

    return NextResponse.json({
      team: { id: team.id, abbreviation: team.abbreviation, eliminatedAt: team.eliminatedAt },
    })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('PATCH /api/admin/teams/[teamId]/eliminate error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
