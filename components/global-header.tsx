'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { auth } from '@/lib/firebase/client'
import { TeamIcon } from '@/components/team-icon'

interface CurrentUser {
  displayName: string
  avatarUrl: string | null
  favoriteTeam?: { colorPrimary: string; colorSecondary: string } | null
}

export function GlobalHeader() {
  const router = useRouter()
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    async function load() {
      const token = await auth.currentUser?.getIdToken()
      if (!token) return
      const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) return
      const data = await res.json()
      setUser(data.user)
    }
    load()
  }, [])

  async function signOut() {
    await auth.signOut()
    document.cookie = 'session=; path=/; max-age=0'
    router.push('/login')
  }

  const avatarGradient = user?.favoriteTeam
    ? `linear-gradient(135deg, ${user.favoriteTeam.colorPrimary}, ${user.favoriteTeam.colorSecondary})`
    : 'linear-gradient(135deg, #FF6B00, #CC5500)'

  return (
    <header className="bg-[#1a1a1a]">
      <div className="px-4 py-3 flex items-center justify-between">
        <span className="text-white font-black tracking-[3px] text-sm">HOCKEYPOOLZ</span>
        <div className="relative">
          <button
            onClick={() => setMenuOpen(o => !o)}
            className="flex items-center gap-2"
          >
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center overflow-hidden"
              style={{ background: avatarGradient }}
            >
              {user?.avatarUrl?.startsWith('https://')
                ? <TeamIcon icon={user.avatarUrl} size="sm" />
                : <span className="text-xs text-white font-bold">{user?.displayName?.[0]?.toUpperCase() ?? '?'}</span>}
            </div>
            <span className="text-white text-xs font-semibold">{user?.displayName ?? ''} ▾</span>
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-lg py-1 min-w-[140px] z-50">
              <button
                onClick={signOut}
                className="w-full text-left px-3 py-2 text-xs font-semibold text-[#121212] hover:bg-[#f8f8f8]"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
