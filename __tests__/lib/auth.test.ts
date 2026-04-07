import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Firebase Admin before importing auth
vi.mock('@/lib/firebase/admin', () => ({
  adminAuth: {
    verifyIdToken: vi.fn(),
  },
}))

import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
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

  it('throws AuthError with "No token provided" when token is missing', async () => {
    await expect(verifyIdToken('')).rejects.toThrow(new AuthError('No token provided'))
  })

  it('throws AuthError with "Invalid token" when Firebase rejects', async () => {
    vi.mocked(adminAuth.verifyIdToken).mockRejectedValue(new Error('Token expired'))
    await expect(verifyIdToken('bad-token')).rejects.toThrow(new AuthError('Invalid token'))
  })
})

describe('getBearerToken', () => {
  it('extracts token from a valid Bearer header', () => {
    expect(getBearerToken('Bearer abc123')).toBe('abc123')
  })

  it('returns empty string when header is null', () => {
    expect(getBearerToken(null)).toBe('')
  })

  it('returns empty string when header does not start with Bearer', () => {
    expect(getBearerToken('Basic abc123')).toBe('')
  })
})
