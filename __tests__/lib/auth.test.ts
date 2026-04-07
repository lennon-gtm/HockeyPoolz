import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Firebase Admin before importing auth
vi.mock('@/lib/firebase/admin', () => ({
  adminAuth: {
    verifyIdToken: vi.fn(),
  },
}))

import { verifyIdToken, AuthError } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase/admin'

describe('verifyIdToken', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns decoded token for a valid token', async () => {
    const mockDecoded = { uid: 'user-123', email: 'test@example.com' }
    vi.mocked(adminAuth.verifyIdToken).mockResolvedValue(mockDecoded as any)

    const result = await verifyIdToken('valid-token')
    expect(result).toEqual(mockDecoded)
    expect(adminAuth.verifyIdToken).toHaveBeenCalledWith('valid-token')
  })

  it('throws AuthError when token is missing', async () => {
    await expect(verifyIdToken('')).rejects.toThrow(AuthError)
    await expect(verifyIdToken('')).rejects.toThrow('No token provided')
  })

  it('throws AuthError when Firebase rejects the token', async () => {
    vi.mocked(adminAuth.verifyIdToken).mockRejectedValue(new Error('Token expired'))
    await expect(verifyIdToken('bad-token')).rejects.toThrow(AuthError)
    await expect(verifyIdToken('bad-token')).rejects.toThrow('Invalid token')
  })
})
