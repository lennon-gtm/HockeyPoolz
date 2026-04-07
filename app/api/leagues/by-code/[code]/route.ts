import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params
    const league = await prisma.league.findUnique({
      where: { inviteCode: code },
      include: {
        commissioner: { select: { displayName: true } },
        members: { select: { id: true } },
      },
    })
    if (!league) return NextResponse.json({ error: 'Invalid invite code' }, { status: 404 })
    return NextResponse.json({ league })
  } catch (error) {
    console.error('GET /api/leagues/by-code/[code] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
