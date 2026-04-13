import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// PUT — set draft positions manually or randomize
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

    const league = await prisma.league.findUnique({ where: { id: leagueId } })
    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
    if (league.commissionerId !== user.id) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })

    const draft = await prisma.draft.findUnique({ where: { leagueId } })
    if (draft && draft.status !== 'pending') return NextResponse.json({ error: 'Cannot change order after draft has started' }, { status: 400 })

    const body = await request.json()
    const { randomize, memberIds } = body

    const members = await prisma.leagueMember.findMany({ where: { leagueId } })

    if (randomize) {
      // Fisher-Yates shuffle
      const shuffled = members.map(m => m.id)
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
      }
      await Promise.all(shuffled.map((memberId, index) =>
        prisma.leagueMember.update({ where: { id: memberId }, data: { draftPosition: index + 1 } })
      ))
      const updated = await prisma.leagueMember.findMany({ where: { leagueId }, orderBy: { draftPosition: 'asc' } })
      return NextResponse.json({ members: updated })
    }

    if (Array.isArray(memberIds)) {
      if (memberIds.length !== members.length) return NextResponse.json({ error: 'memberIds must include all league members' }, { status: 400 })
      const memberSet = new Set(members.map(m => m.id))
      if (!memberIds.every((id: string) => memberSet.has(id))) return NextResponse.json({ error: 'Invalid member IDs' }, { status: 400 })
      await Promise.all(memberIds.map((memberId: string, index: number) =>
        prisma.leagueMember.update({ where: { id: memberId }, data: { draftPosition: index + 1 } })
      ))
      const updated = await prisma.leagueMember.findMany({ where: { leagueId }, orderBy: { draftPosition: 'asc' } })
      return NextResponse.json({ members: updated })
    }

    return NextResponse.json({ error: 'Provide either randomize: true or memberIds array' }, { status: 400 })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('PUT /api/leagues/[id]/draft/order error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
