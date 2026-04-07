import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const teams = await prisma.nhlTeam.findMany({
    orderBy: [{ conference: 'asc' }, { division: 'asc' }, { city: 'asc' }],
  })
  return NextResponse.json({ teams })
}
