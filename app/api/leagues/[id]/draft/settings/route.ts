import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function PATCH(
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

    const body = await request.json().catch(() => ({}))
    const { autodraftEnabled, autodraftStrategy } = body

    const updateData: Record<string, unknown> = {}
    if (typeof autodraftEnabled === 'boolean') updateData.autodraftEnabled = autodraftEnabled
    if (autodraftStrategy === 'adp' || autodraftStrategy === 'wishlist') {
      updateData.autodraftStrategy = autodraftStrategy
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    const updated = await prisma.leagueMember.update({ where: { id: member.id }, data: updateData })
    return NextResponse.json({ member: updated })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('PATCH /api/leagues/[id]/draft/settings error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
