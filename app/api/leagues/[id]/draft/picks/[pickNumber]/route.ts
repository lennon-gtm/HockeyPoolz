import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

type RouteParams = { params: Promise<{ id: string; pickNumber: string }> }

async function requireCommissioner(request: NextRequest, leagueId: string) {
  const token = getBearerToken(request.headers.get('authorization'))
  const decoded = await verifyIdToken(token)
  const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })
  if (!user) return { error: NextResponse.json({ error: 'User not found' }, { status: 404 }) }

  const league = await prisma.league.findUnique({ where: { id: leagueId } })
  if (!league) return { error: NextResponse.json({ error: 'League not found' }, { status: 404 }) }
  if (league.commissionerId !== user.id) {
    return { error: NextResponse.json({ error: 'Commissioner only' }, { status: 403 }) }
  }

  return { league }
}

// PATCH — swap the player assigned to a specific pick. Body: { playerId: number }.
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: leagueId, pickNumber: pickNumStr } = await params
    const pickNumber = parseInt(pickNumStr, 10)
    if (isNaN(pickNumber) || pickNumber < 1) {
      return NextResponse.json({ error: 'Invalid pick number' }, { status: 400 })
    }

    const authz = await requireCommissioner(request, leagueId)
    if ('error' in authz) return authz.error
    const { league } = authz

    const body = await request.json().catch(() => ({}))
    const newPlayerId = body?.playerId
    if (typeof newPlayerId !== 'number') {
      return NextResponse.json({ error: 'playerId (number) is required' }, { status: 400 })
    }

    const draft = await prisma.draft.findUnique({ where: { leagueId } })
    if (!draft) return NextResponse.json({ error: 'No draft for this league' }, { status: 404 })

    const pick = await prisma.draftPick.findUnique({
      where: { draftId_pickNumber: { draftId: draft.id, pickNumber } },
    })
    if (!pick) return NextResponse.json({ error: 'Pick not found' }, { status: 404 })

    const newPlayer = await prisma.nhlPlayer.findUnique({ where: { id: newPlayerId } })
    if (!newPlayer) return NextResponse.json({ error: 'Player not found' }, { status: 404 })

    // The new player can't already be held by a different pick in this draft.
    const clash = await prisma.draftPick.findFirst({
      where: { draftId: draft.id, playerId: newPlayerId, NOT: { pickNumber } },
    })
    if (clash) {
      return NextResponse.json({ error: 'That player is already drafted' }, { status: 409 })
    }

    const caps = {
      rosterForwards: league.rosterForwards,
      rosterDefense: league.rosterDefense,
      rosterGoalies: league.rosterGoalies,
    }

    // Count this team's picks *other than the one being replaced*, then see
    // whether adding the new player would exceed the position cap.
    const others = await prisma.draftPick.findMany({
      where: { draftId: draft.id, leagueMemberId: pick.leagueMemberId, NOT: { pickNumber } },
      select: { player: { select: { position: true } } },
    })
    const counts = { F: 0, D: 0, G: 0 }
    for (const o of others) {
      if (o.player.position === 'G') counts.G++
      else if (o.player.position === 'D') counts.D++
      else counts.F++
    }
    const isFull =
      (newPlayer.position === 'G' && counts.G >= caps.rosterGoalies) ||
      (newPlayer.position === 'D' && counts.D >= caps.rosterDefense) ||
      (newPlayer.position !== 'G' && newPlayer.position !== 'D' && counts.F >= caps.rosterForwards)
    if (isFull) {
      const bucket = newPlayer.position === 'G' ? 'Goalie' : newPlayer.position === 'D' ? 'Defense' : 'Forward'
      return NextResponse.json({ error: `${bucket} slots are full for that team` }, { status: 400 })
    }

    await prisma.draftPick.update({
      where: { draftId_pickNumber: { draftId: draft.id, pickNumber } },
      data: { playerId: newPlayerId },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    const msg = error instanceof Error ? error.message : 'Internal server error'
    if (/slots are full/.test(msg)) return NextResponse.json({ error: msg }, { status: 400 })
    console.error('PATCH /api/leagues/[id]/draft/picks/[pickNumber] error:', error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// DELETE — rewind draft: delete this pick and every pick after it, set the
// current pick pointer back here, and pause the draft so the commissioner can
// review before resuming.
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: leagueId, pickNumber: pickNumStr } = await params
    const pickNumber = parseInt(pickNumStr, 10)
    if (isNaN(pickNumber) || pickNumber < 1) {
      return NextResponse.json({ error: 'Invalid pick number' }, { status: 400 })
    }

    const authz = await requireCommissioner(request, leagueId)
    if ('error' in authz) return authz.error
    const { league } = authz

    const draft = await prisma.draft.findUnique({ where: { leagueId } })
    if (!draft) return NextResponse.json({ error: 'No draft for this league' }, { status: 404 })

    const pick = await prisma.draftPick.findUnique({
      where: { draftId_pickNumber: { draftId: draft.id, pickNumber } },
    })
    if (!pick) return NextResponse.json({ error: 'Pick not found' }, { status: 404 })

    await prisma.$transaction(async (tx) => {
      await tx.draftPick.deleteMany({
        where: { draftId: draft.id, pickNumber: { gte: pickNumber } },
      })
      await tx.draft.update({
        where: { id: draft.id },
        data: {
          currentPickNumber: pickNumber,
          status: 'paused',
          pickDeadline: null,
          completedAt: null,
        },
      })
      // If the draft had already completed, the league was promoted; bring it
      // back to 'draft' so mid-draft gates still apply.
      if (league.status === 'active') {
        await tx.league.update({
          where: { id: leagueId },
          data: { status: 'draft' },
        })
      }
    })

    return NextResponse.json({ success: true, rewoundTo: pickNumber })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('DELETE /api/leagues/[id]/draft/picks/[pickNumber] error:', error)
    return NextResponse.json({ error: 'Rewind failed' }, { status: 500 })
  }
}
