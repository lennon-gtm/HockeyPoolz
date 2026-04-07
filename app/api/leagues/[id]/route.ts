import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // League detail is public for invite preview — no auth required
  const { id } = await params
  const league = await prisma.league.findUnique({
    where: { id },
    include: {
      commissioner: { select: { displayName: true, avatarUrl: true } },
      members: {
        include: { user: { select: { displayName: true, avatarUrl: true } } },
      },
      scoringSettings: true,
    },
  })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  return NextResponse.json({ league })
}
