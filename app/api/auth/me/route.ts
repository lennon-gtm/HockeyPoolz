import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest) {
  try {
    const token = getBearerToken(request.headers.get('authorization'))
    const decoded = await verifyIdToken(token)

    const body = await request.json().catch(() => ({}))
    const { favoriteTeamId, displayName: bodyDisplayName, avatarUrl: bodyAvatarUrl } = body

    const select = {
      id: true,
      email: true,
      displayName: true,
      avatarUrl: true,
      favoriteTeamId: true,
      createdAt: true,
    }

    // Try upsert by firebaseUid first
    let user = await prisma.user.upsert({
      where: { firebaseUid: decoded.uid },
      update: {
        email: decoded.email ?? '',
        ...(bodyDisplayName && { displayName: bodyDisplayName }),
        ...(bodyAvatarUrl !== undefined && { avatarUrl: bodyAvatarUrl }),
        ...(favoriteTeamId && { favoriteTeamId }),
      },
      create: {
        firebaseUid: decoded.uid,
        email: decoded.email ?? '',
        displayName: bodyDisplayName ?? decoded.name ?? decoded.email?.split('@')[0] ?? 'Player',
        avatarUrl: bodyAvatarUrl ?? decoded.picture ?? null,
        favoriteTeamId: favoriteTeamId ?? null,
      },
      select,
    }).catch(async (err) => {
      // If a user with this email already exists under a different firebaseUid
      // (e.g. user deleted their Firebase account and re-registered), re-link it
      if (err?.code === 'P2002') {
        return prisma.user.update({
          where: { email: decoded.email ?? '' },
          data: {
            firebaseUid: decoded.uid,
            ...(bodyDisplayName && { displayName: bodyDisplayName }),
            ...(bodyAvatarUrl !== undefined && { avatarUrl: bodyAvatarUrl }),
            ...(favoriteTeamId && { favoriteTeamId }),
          },
          select,
        })
      }
      throw err
    })

    return NextResponse.json({ user })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 })
    }
    console.error('POST /api/auth/me error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const token = getBearerToken(request.headers.get('authorization'))
    const decoded = await verifyIdToken(token)

    const user = await prisma.user.findUnique({
      where: { firebaseUid: decoded.uid },
      select: {
        id: true,
        email: true,
        displayName: true,
        avatarUrl: true,
        favoriteTeamId: true,
        createdAt: true,
        favoriteTeam: true,
      },
    })

    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    return NextResponse.json({ user })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 })
    }
    console.error('GET /api/auth/me error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
