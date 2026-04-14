'use client'
import { useState } from 'react'
import { signInWithPopup, GoogleAuthProvider, OAuthProvider } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function signIn(provider: 'google' | 'apple') {
    setLoading(true)
    setError('')
    try {
      const p = provider === 'google'
        ? new GoogleAuthProvider()
        : new OAuthProvider('apple.com')
      const result = await signInWithPopup(auth, p)
      const token = await result.user.getIdToken()

      const res = await fetch('/api/auth/me', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()

      if (!res.ok) {
        setError('Sign in failed. Please try again.')
        return
      }

      document.cookie = `session=${token}; path=/; max-age=3600; SameSite=Strict`

      router.push('/')
    } catch {
      setError('Sign in failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <h1 className="text-3xl font-black tracking-widest text-center mb-2">HOCKEYPOOLZ</h1>
        <p className="text-center text-gray-500 mb-8 text-sm">Sign in to join or create a league</p>
        {error && <p className="text-red-600 text-sm text-center mb-4">{error}</p>}
        <button
          onClick={() => signIn('google')}
          disabled={loading}
          className="w-full mb-3 py-3 px-4 rounded-xl border-2 border-gray-200 font-semibold hover:border-gray-400 transition disabled:opacity-50"
        >
          Continue with Google
        </button>
        <button
          onClick={() => signIn('apple')}
          disabled={loading}
          className="w-full py-3 px-4 rounded-xl bg-black text-white font-semibold hover:bg-gray-900 transition disabled:opacity-50"
        >
          Continue with Apple
        </button>
      </div>
    </div>
  )
}
