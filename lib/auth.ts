import { adminAuth } from '@/lib/firebase/admin'
import type { DecodedIdToken } from 'firebase-admin/auth'

export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

export async function verifyIdToken(token: string): Promise<DecodedIdToken> {
  if (!token) throw new AuthError('No token provided')
  try {
    return await adminAuth.verifyIdToken(token)
  } catch {
    throw new AuthError('Invalid token')
  }
}

export function getBearerToken(authHeader: string | null): string {
  if (!authHeader?.startsWith('Bearer ')) return ''
  return authHeader.slice(7)
}
