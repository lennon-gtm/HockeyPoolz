'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let unsub: (() => void) | undefined
    auth.authStateReady().then(() => {
      unsub = onAuthStateChanged(auth, async (user) => {
        if (!user) {
          router.push('/login')
          return
        }
        const token = await user.getIdToken()
        document.cookie = `session=${token}; path=/; max-age=3600; SameSite=Strict`
        setChecking(false)
      })
    })
    return () => unsub?.()
  }, [router])

  if (checking) {
    return <div className="min-h-screen bg-white flex items-center justify-center">
      <p className="text-gray-400 text-sm">Loading...</p>
    </div>
  }

  return <>{children}</>
}
