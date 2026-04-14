import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest) {
  try {
    const token = getBearerToken(request.headers.get('authorization'))
    const decoded = await verifyIdToken(token)

    const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })
    if (!user?.isPlatformAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    // Null out any teamIcon that looks like a URL
    const result = await prisma.leagueMember.updateMany({
      where: { teamIcon: { startsWith: 'http' } },
      data: { teamIcon: null },
    })

    return NextResponse.json({ fixed: result.count })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('POST /api/admin/fix-team-icons error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
