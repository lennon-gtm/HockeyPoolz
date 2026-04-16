import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams.get('q')?.trim() ?? ''
    if (q.length < 2) return NextResponse.json({ players: [] })

    const players = await prisma.nhlPlayer.findMany({
      where: { name: { contains: q, mode: 'insensitive' } },
      select: { id: true, name: true, teamId: true, position: true },
      orderBy: { name: 'asc' },
      take: 10,
    })

    return NextResponse.json({ players })
  } catch (error) {
    console.error('GET /api/players error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
