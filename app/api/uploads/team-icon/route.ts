import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const MAX_BYTES = 2 * 1024 * 1024
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

export async function POST(request: NextRequest) {
  try {
    const token = getBearerToken(request.headers.get('authorization'))
    const decoded = await verifyIdToken(token)

    const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const form = await request.formData()
    const file = form.get('image')

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 })
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'Only PNG, JPEG, GIF, or WEBP images are allowed' }, { status: 400 })
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'Image must be 2MB or smaller' }, { status: 400 })
    }

    const ext = file.type.split('/')[1]
    const filename = `team-icons/${user.id}-${Date.now()}.${ext}`

    const blob = await put(filename, file, { access: 'public' })

    return NextResponse.json({ url: blob.url })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('POST /api/uploads/team-icon error:', error)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
