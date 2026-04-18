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

    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      include: { draft: true },
    })
    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
    if (league.commissionerId !== user.id) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
    if (league.status !== 'setup') return NextResponse.json({ error: 'Settings are locked once the draft has started' }, { status: 400 })

    const body = await request.json().catch(() => ({}))
    const { rosterForwards, rosterDefense, rosterGoalies, scheduledStartAt, pickTimeLimitSecs } = body

    const leagueUpdate: Record<string, unknown> = {}
    if (rosterForwards !== undefined) {
      if (typeof rosterForwards !== 'number' || rosterForwards < 1 || rosterForwards > 12) {
        return NextResponse.json({ error: 'Forwards must be 1–12' }, { status: 400 })
      }
      leagueUpdate.rosterForwards = rosterForwards
    }
    if (rosterDefense !== undefined) {
      if (typeof rosterDefense !== 'number' || rosterDefense < 1 || rosterDefense > 8) {
        return NextResponse.json({ error: 'Defensemen must be 1–8' }, { status: 400 })
      }
      leagueUpdate.rosterDefense = rosterDefense
    }
    if (rosterGoalies !== undefined) {
      if (typeof rosterGoalies !== 'number' || rosterGoalies < 1 || rosterGoalies > 4) {
        return NextResponse.json({ error: 'Goalies must be 1–4' }, { status: 400 })
      }
      leagueUpdate.rosterGoalies = rosterGoalies
    }

    if (Object.keys(leagueUpdate).length > 0) {
      await prisma.league.update({ where: { id: leagueId }, data: leagueUpdate })
    }

    const draftUpdate: Record<string, unknown> = {}
    if (scheduledStartAt !== undefined) {
      if (scheduledStartAt === null) {
        draftUpdate.scheduledStartAt = null
      } else if (typeof scheduledStartAt === 'string') {
        const d = new Date(scheduledStartAt)
        if (isNaN(d.getTime())) return NextResponse.json({ error: 'Invalid scheduledStartAt' }, { status: 400 })
        draftUpdate.scheduledStartAt = d
      } else {
        return NextResponse.json({ error: 'scheduledStartAt must be ISO string or null' }, { status: 400 })
      }
    }
    if (pickTimeLimitSecs !== undefined) {
      if (typeof pickTimeLimitSecs !== 'number' || pickTimeLimitSecs < 30 || pickTimeLimitSecs > 300) {
        return NextResponse.json({ error: 'Pick time limit must be 30–300 seconds' }, { status: 400 })
      }
      draftUpdate.pickTimeLimitSecs = pickTimeLimitSecs
    }

    if (Object.keys(draftUpdate).length > 0) {
      if (league.draft) {
        await prisma.draft.update({ where: { leagueId }, data: draftUpdate })
      } else {
        await prisma.draft.create({
          data: {
            leagueId,
            pickTimeLimitSecs: typeof pickTimeLimitSecs === 'number' ? pickTimeLimitSecs : 90,
            scheduledStartAt: draftUpdate.scheduledStartAt as Date | null | undefined,
          },
        })
      }
    }

    const updated = await prisma.league.findUnique({
      where: { id: leagueId },
      include: { draft: true },
    })
    return NextResponse.json({ league: updated })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('PATCH /api/leagues/[id]/schedule error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
