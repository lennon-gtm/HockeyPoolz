import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

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

    const league = await prisma.league.findUnique({ where: { id: leagueId } })
    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
    if (league.commissionerId !== user.id) {
      return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
    }

    const draft = await prisma.draft.findUnique({ where: { leagueId } })
    if (!draft) return NextResponse.json({ error: 'No draft for this league' }, { status: 404 })

    const body = await request.json().catch(() => ({}))
    const randomize = body?.randomize === true

    await prisma.$transaction(async (tx) => {
      // Wipe picks.
      await tx.draftPick.deleteMany({ where: { draftId: draft.id } })

      // Optional: reshuffle draft order (Fisher–Yates).
      if (randomize) {
        const members = await tx.leagueMember.findMany({
          where: { leagueId },
          select: { id: true },
          orderBy: { joinedAt: 'asc' },
        })
        const positions = members.map((_, i) => i + 1)
        for (let i = positions.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1))
          ;[positions[i], positions[j]] = [positions[j], positions[i]]
        }
        for (let i = 0; i < members.length; i++) {
          await tx.leagueMember.update({
            where: { id: members[i].id },
            data: { draftPosition: positions[i] },
          })
        }
      }

      // Reset draft state.
      await tx.draft.update({
        where: { id: draft.id },
        data: {
          status: 'pending',
          currentPickNumber: 1,
          startedAt: null,
          pickDeadline: null,
          completedAt: null,
        },
      })

      // Any post-setup status (draft in progress, completed, or frozen)
      // needs to go back to 'setup' so the commissioner can start fresh.
      if (league.status !== 'setup') {
        await tx.league.update({
          where: { id: leagueId },
          data: { status: 'setup' },
        })
      }
    })

    return NextResponse.json({ success: true, randomized: randomize })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('POST /api/leagues/[id]/draft/restart error:', error)
    return NextResponse.json({ error: 'Restart failed' }, { status: 500 })
  }
}
