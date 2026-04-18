import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { generateDraftDayBulletin } from '@/lib/recap-service'

// GET — fetch current draft for a league
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: leagueId } = await params
    const token = getBearerToken(request.headers.get('authorization'))
    const decoded = await verifyIdToken(token)
    const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const member = await prisma.leagueMember.findUnique({ where: { leagueId_userId: { leagueId, userId: user.id } } })
    if (!member) return NextResponse.json({ error: 'Not a member of this league' }, { status: 403 })

    const draft = await prisma.draft.findUnique({ where: { leagueId } })
    return NextResponse.json({ draft })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('GET /api/leagues/[id]/draft error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST — commissioner creates the draft
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
    if (league.commissionerId !== user.id) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
    if (league.status !== 'setup') return NextResponse.json({ error: 'League is not in setup status' }, { status: 400 })

    const existing = await prisma.draft.findUnique({ where: { leagueId } })
    if (existing && !existing.isMock) return NextResponse.json({ error: 'Draft already exists' }, { status: 409 })

    const body = await request.json().catch(() => ({}))
    const { pickTimeLimitSecs = 90, isMock = false } = body

    // Delete any existing mock draft if creating a new one
    if (existing?.isMock) await prisma.draft.delete({ where: { leagueId } })

    const draft = await prisma.draft.create({
      data: { leagueId, pickTimeLimitSecs, isMock },
    })

    return NextResponse.json({ draft }, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('POST /api/leagues/[id]/draft error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH — commissioner controls: start | pause | resume | update settings
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

    const league = await prisma.league.findUnique({ where: { id: leagueId } })
    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
    if (league.commissionerId !== user.id) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })

    const draft = await prisma.draft.findUnique({ where: { leagueId } })
    if (!draft) return NextResponse.json({ error: 'Draft not created yet' }, { status: 404 })

    const body = await request.json().catch(() => ({}))
    const { action, pickTimeLimitSecs } = body

    if (action === 'start') {
      if (draft.status !== 'pending') return NextResponse.json({ error: 'Draft is not pending' }, { status: 400 })

      // Verify all members have draft positions assigned
      const members = await prisma.leagueMember.findMany({ where: { leagueId } })
      const unassigned = members.filter(m => m.draftPosition === null)
      if (unassigned.length > 0) return NextResponse.json({ error: 'All members must have draft positions set' }, { status: 400 })

      const pickDeadline = new Date(Date.now() + draft.pickTimeLimitSecs * 1000)
      const updated = await prisma.draft.update({
        where: { leagueId },
        data: { status: 'active', startedAt: new Date(), pickDeadline },
      })
      // Transition league to draft status
      if (!draft.isMock) {
        await prisma.league.update({ where: { id: leagueId }, data: { status: 'draft' } })
        // Generate draft-day bulletin (non-blocking — don't fail the draft start if this errors)
        generateDraftDayBulletin(leagueId).catch(err =>
          console.error('Draft day bulletin error:', err)
        )
      }
      return NextResponse.json({ draft: updated })
    }

    if (action === 'pause') {
      if (draft.status !== 'active') return NextResponse.json({ error: 'Draft is not active' }, { status: 400 })
      const updated = await prisma.draft.update({ where: { leagueId }, data: { status: 'paused', pickDeadline: null } })
      return NextResponse.json({ draft: updated })
    }

    if (action === 'resume') {
      if (draft.status !== 'paused') return NextResponse.json({ error: 'Draft is not paused' }, { status: 400 })
      const pickDeadline = new Date(Date.now() + draft.pickTimeLimitSecs * 1000)
      const updated = await prisma.draft.update({ where: { leagueId }, data: { status: 'active', pickDeadline } })
      return NextResponse.json({ draft: updated })
    }

    if (typeof pickTimeLimitSecs === 'number') {
      if (draft.status !== 'pending') return NextResponse.json({ error: 'Can only change settings while draft is pending' }, { status: 400 })
      if (pickTimeLimitSecs < 30 || pickTimeLimitSecs > 300) return NextResponse.json({ error: 'Pick time limit must be 30–300 seconds' }, { status: 400 })
      const updated = await prisma.draft.update({ where: { leagueId }, data: { pickTimeLimitSecs } })
      return NextResponse.json({ draft: updated })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('PATCH /api/leagues/[id]/draft error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
