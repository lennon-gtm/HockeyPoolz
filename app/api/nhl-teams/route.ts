import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    const playoffOnly = request.nextUrl.searchParams.get('playoffQualified') !== 'false'
    const teams = await prisma.nhlTeam.findMany({
      where: playoffOnly ? { playoffQualified: true } : undefined,
      select: { id: true, name: true, abbreviation: true, colorPrimary: true },
      orderBy: { abbreviation: 'asc' },
    })
    return NextResponse.json({ teams })
  } catch (error) {
    console.error('GET /api/nhl-teams error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
