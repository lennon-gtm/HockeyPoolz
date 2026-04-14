import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // League detail is public for invite preview — no auth required
    const { id } = await params
    const league = await prisma.league.findUnique({
      where: { id },
      include: {
        commissioner: { select: { displayName: true, avatarUrl: true } },
        members: {
          include: {
            user: { select: { id: true, displayName: true, avatarUrl: true } },
            favoriteTeam: { select: { colorPrimary: true, colorSecondary: true, name: true } },
          },
        },
        scoringSettings: true,
      },
    })
    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
    return NextResponse.json({ league })
  } catch (error) {
    console.error('GET /api/leagues/[id] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
