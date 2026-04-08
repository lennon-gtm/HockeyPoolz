import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const position = searchParams.get('position')   // C|LW|RW|D|G
    const rawSearch = searchParams.get('search')?.trim()
    const search = rawSearch && rawSearch.length <= 100 ? rawSearch : null
    const draftId = searchParams.get('draftId')     // filter to available players only
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1)
    const pageSize = 50

    // Build where clause
    const where: Record<string, unknown> = { isActive: true }

    if (position && ['C', 'LW', 'RW', 'D', 'G'].includes(position)) {
      where.position = position
    }
    if (search) {
      where.name = { contains: search, mode: 'insensitive' }
    }

    let draftedIds: number[] = []
    if (draftId) {
      const picks = await prisma.draftPick.findMany({
        where: { draftId },
        select: { playerId: true },
      })
      draftedIds = picks.map(p => p.playerId)
      if (draftedIds.length > 0) {
        where.id = { notIn: draftedIds }
      }
    }

    const [players, total] = await Promise.all([
      prisma.nhlPlayer.findMany({
        where,
        include: { team: { select: { id: true, name: true, colorPrimary: true } } },
        orderBy: { adp: { sort: 'asc', nulls: 'last' } },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.nhlPlayer.count({ where }),
    ])

    return NextResponse.json({ players, total, page, pageSize })
  } catch (error) {
    console.error('GET /api/nhl-players error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
