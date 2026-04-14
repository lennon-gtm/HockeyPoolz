// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@vercel/blob', () => ({
  put: vi.fn(async (name: string) => ({
    url: `https://blob.vercel-storage.com/${name}`,
  })),
}))

vi.mock('@/lib/auth', () => ({
  getBearerToken: vi.fn(() => 'fake-token'),
  verifyIdToken: vi.fn(async () => ({ uid: 'fake-uid' })),
  AuthError: class AuthError extends Error {},
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () => ({ id: 'user-1', firebaseUid: 'fake-uid' })),
    },
  },
}))

import { POST } from '../../../app/api/uploads/team-icon/route'

function makeRequest(body: FormData): Request {
  return new Request('http://localhost/api/uploads/team-icon', {
    method: 'POST',
    headers: { authorization: 'Bearer fake-token' },
    body,
  })
}

describe('POST /api/uploads/team-icon', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 when no file is provided', async () => {
    const form = new FormData()
    const res = await POST(makeRequest(form) as never)
    expect(res.status).toBe(400)
  })

  it('rejects non-image files', async () => {
    const form = new FormData()
    const file = new File(['hello'], 'test.txt', { type: 'text/plain' })
    form.append('image', file)
    const res = await POST(makeRequest(form) as never)
    expect(res.status).toBe(400)
  })

  it('rejects files larger than 2MB', async () => {
    const form = new FormData()
    const bigBuffer = new Uint8Array(2 * 1024 * 1024 + 1)
    const file = new File([bigBuffer], 'big.png', { type: 'image/png' })
    form.append('image', file)
    const res = await POST(makeRequest(form) as never)
    expect(res.status).toBe(400)
  })

  it('uploads a valid image and returns the URL', async () => {
    const form = new FormData()
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'icon.png', { type: 'image/png' })
    form.append('image', file)
    const res = await POST(makeRequest(form) as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.url).toContain('https://blob.vercel-storage.com/')
  })
})
