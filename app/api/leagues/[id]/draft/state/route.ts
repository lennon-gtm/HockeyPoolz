import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getPickerIndex, getTotalPicks } from '@/lib/draft-engine'
import { rosterTotal } from '@/lib/roster'

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

    const league = await prisma.league.findUnique({ where: { id: leagueId } })
    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

    const myMember = await prisma.leagueMember.findUnique({
      where: { leagueId_userId: { leagueId, userId: user.id } },
    })
    if (!myMember) return NextResponse.json({ error: 'Not a member of this league' }, { status: 403 })

    const draft = await prisma.draft.findUnique({ where: { leagueId } })
    if (!draft) return NextResponse.json({ draft: null, myLeagueMemberId: myMember.id })

    const members = await prisma.leagueMember.findMany({
      where: { leagueId },
      include: {
        user: { select: { displayName: true } },
        favoriteTeam: { select: { colorPrimary: true } },
      },
      orderBy: { draftPosition: 'asc' },
    })

    const picks = await prisma.draftPick.findMany({
      where: { draftId: draft.id },
      include: {
        player: { select: { id: true, name: true, position: true, teamId: true, headshotUrl: true, injuryStatus: true } },
        leagueMember: { select: { id: true, teamName: true, teamIcon: true } },
      },
      orderBy: { pickNumber: 'asc' },
    })

    const totalPicks = getTotalPicks(members.length, rosterTotal(league))

    let currentPicker = null
    if (draft.status === 'active' || draft.status === 'paused') {
      if (draft.currentPickNumber <= totalPicks) {
        const idx = getPickerIndex(draft.currentPickNumber, members.length)
        const picker = members[idx]
        currentPicker = {
          leagueMemberId: picker.id,
          teamName: picker.teamName,
          teamIcon: picker.teamIcon,
          draftPosition: picker.draftPosition,
          autodraftEnabled: picker.autodraftEnabled,
          isMe: picker.id === myMember.id,
          colorPrimary: picker.favoriteTeam?.colorPrimary ?? null,
        }
      }
    }

    const memberSummaries = members.map(m => ({
      leagueMemberId: m.id,
      teamName: m.teamName,
      teamIcon: m.teamIcon,
      userName: m.user.displayName,
      draftPosition: m.draftPosition,
      pickCount: picks.filter(p => p.leagueMemberId === m.id).length,
      autodraftEnabled: m.autodraftEnabled,
      isCommissioner: league.commissionerId === m.userId,
      colorPrimary: m.favoriteTeam?.colorPrimary ?? null,
      draftLobbyReady: m.draftLobbyReady,
    }))

    const myMemberRow = members.find(m => m.id === myMember.id)
    const myColor = myMemberRow?.favoriteTeam?.colorPrimary ?? null

    return NextResponse.json({
      draft: {
        id: draft.id,
        status: draft.status,
        currentPickNumber: draft.currentPickNumber,
        totalPicks,
        pickDeadline: draft.pickDeadline?.toISOString() ?? null,
        pickTimeLimitSecs: draft.pickTimeLimitSecs,
        isMock: draft.isMock,
        startedAt: draft.startedAt?.toISOString() ?? null,
        scheduledStartAt: draft.scheduledStartAt?.toISOString() ?? null,
      },
      currentPicker,
      picks: picks.map(p => ({
        pickNumber: p.pickNumber,
        round: p.round,
        leagueMemberId: p.leagueMemberId,
        teamName: p.leagueMember.teamName,
        teamIcon: p.leagueMember.teamIcon,
        player: p.player,
        pickSource: p.pickSource,
        pickedAt: p.pickedAt.toISOString(),
      })),
      members: memberSummaries,
      myLeagueMemberId: myMember.id,
      isCommissioner: league.commissionerId === user.id,
      myColor,
    })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('GET /api/leagues/[id]/draft/state error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
