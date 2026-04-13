import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getPickerIndex, getRound, getTotalPicks, getAutoPickPlayerId } from '@/lib/draft-engine'

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
    if (!member) return NextResponse.json({ error: 'Not a member of this league' }, { status: 403 })

    const league = await prisma.league.findUnique({ where: { id: leagueId } })
    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

    const draft = await prisma.draft.findUnique({ where: { leagueId } })
    if (!draft) return NextResponse.json({ error: 'No draft for this league' }, { status: 404 })
    if (draft.status === 'paused') return NextResponse.json({ error: 'Draft is paused' }, { status: 400 })
    if (draft.status !== 'active') return NextResponse.json({ error: 'Draft is not active' }, { status: 400 })

    const body = await request.json().catch(() => ({}))
    const { playerId, autoPickExpired } = body

    // Get members sorted by draftPosition
    const allMembers = await prisma.leagueMember.findMany({
      where: { leagueId },
      orderBy: { draftPosition: 'asc' },
    })
    const totalPicks = getTotalPicks(allMembers.length, league.playersPerTeam)
    if (draft.currentPickNumber > totalPicks) {
      return NextResponse.json({ error: 'Draft is already complete' }, { status: 400 })
    }

    const pickerIndex = getPickerIndex(draft.currentPickNumber, allMembers.length)
    const currentPicker = allMembers[pickerIndex]

    // Validate who can make this pick
    if (autoPickExpired) {
      // Any authenticated member can trigger timer expiry, but deadline must have passed
      if (!draft.pickDeadline || new Date() < draft.pickDeadline) {
        return NextResponse.json({ error: 'Pick timer has not expired' }, { status: 400 })
      }
    } else if (!currentPicker.autodraftEnabled) {
      // Normal manual pick: must be the current picker
      if (currentPicker.id !== member.id) {
        return NextResponse.json({ error: 'Not your turn' }, { status: 403 })
      }
    }

    // Execute picks in a transaction — cascades through consecutive autodraft members
    const result = await prisma.$transaction(async (tx) => {
      let currentPickNum = draft.currentPickNumber
      const picksMade: number[] = []

      while (currentPickNum <= totalPicks) {
        const idx = getPickerIndex(currentPickNum, allMembers.length)
        const picker = allMembers[idx]

        // Determine what player to pick
        let selectedPlayerId: number
        let pickSource: 'manual' | 'timed_autopick' | 'autodraft'

        const isFirstPick = currentPickNum === draft.currentPickNumber

        if (isFirstPick && autoPickExpired) {
          selectedPlayerId = await getAutoPickPlayerId(draft.id, picker.id, picker.autodraftStrategy, tx)
          pickSource = 'timed_autopick'
        } else if (picker.autodraftEnabled && !isFirstPick) {
          selectedPlayerId = await getAutoPickPlayerId(draft.id, picker.id, picker.autodraftStrategy, tx)
          pickSource = 'autodraft'
        } else if (isFirstPick && !autoPickExpired) {
          if (typeof playerId !== 'number') throw new Error('playerId is required')
          selectedPlayerId = playerId
          pickSource = picker.autodraftEnabled ? 'autodraft' : 'manual'
        } else {
          // Next picker is not autodraft — stop cascading
          break
        }

        // Validate player exists and is available
        const player = await tx.nhlPlayer.findUnique({ where: { id: selectedPlayerId } })
        if (!player) throw new Error('Player not found')

        const round = getRound(currentPickNum, allMembers.length)

        // Insert pick — unique constraint (draftId, pickNumber) prevents race conditions
        await tx.draftPick.create({
          data: {
            draftId: draft.id,
            leagueMemberId: picker.id,
            playerId: selectedPlayerId,
            round,
            pickNumber: currentPickNum,
            pickSource,
          },
        })

        picksMade.push(currentPickNum)
        currentPickNum++

        // After the first pick, only continue if this is a non-first autodraft member
        if (!picker.autodraftEnabled && !isFirstPick) break
        // If first pick was manual and was picked, now cascade if next is autodraft
        if (isFirstPick && !picker.autodraftEnabled) {
          // First pick done (manual), now loop for any consecutive autodraft members
        }
      }

      // Check if draft is complete
      const isDraftComplete = currentPickNum > totalPicks

      const newDeadline = isDraftComplete
        ? null
        : new Date(Date.now() + draft.pickTimeLimitSecs * 1000)

      await tx.draft.update({
        where: { id: draft.id },
        data: {
          currentPickNumber: currentPickNum,
          pickDeadline: newDeadline,
          status: isDraftComplete ? 'complete' : 'active',
          completedAt: isDraftComplete ? new Date() : null,
        },
      })

      // When real draft completes, transition league to active
      if (isDraftComplete && !draft.isMock) {
        await tx.league.update({ where: { id: leagueId }, data: { status: 'active' } })
      }

      return { picksMade, isDraftComplete, newPickNumber: currentPickNum }
    })

    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    // Unique constraint violation = duplicate pick attempt
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'Pick already recorded' }, { status: 409 })
    }
    const msg = error instanceof Error ? error.message : 'Internal server error'
    console.error('POST /api/leagues/[id]/draft/pick error:', error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
