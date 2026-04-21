'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@/lib/firebase/client'
import { TeamIcon } from '@/components/team-icon'

interface CurrentUser {
  displayName: string
  avatarUrl: string | null
  favoriteTeam?: { colorPrimary: string; colorSecondary: string } | null
}

interface LeagueSummary {
  id: string
  name: string
  status: string
}

export function GlobalHeader() {
  const router = useRouter()
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [leagues, setLeagues] = useState<LeagueSummary[]>([])
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    async function load() {
      const token = await auth.currentUser?.getIdToken()
      if (!token) return
      const headers = { Authorization: `Bearer ${token}` }
      const [meRes, leaguesRes] = await Promise.all([
        fetch('/api/auth/me', { headers }),
        fetch('/api/leagues', { headers }),
      ])
      if (meRes.ok) setUser((await meRes.json()).user)
      if (leaguesRes.ok) setLeagues((await leaguesRes.json()).leagues ?? [])
    }
    load()
  }, [])

  async function signOut() {
    await auth.signOut()
    document.cookie = 'session=; path=/; max-age=0'
    router.push('/')
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
            <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-lg py-1 min-w-[200px] z-50">
              <Link
                href="/league/create"
                onClick={() => setMenuOpen(false)}
                className="block px-3 py-2 text-xs font-black uppercase tracking-widest text-[#c2410c] hover:bg-[#fff7ed]"
              >
                + Create Pool
              </Link>
              <div className="border-t border-[#f0f0f0] my-1" />
              <Link
                href="/?pick=1"
                onClick={() => setMenuOpen(false)}
                className="block px-3 py-2 text-xs font-bold uppercase tracking-widest text-[#98989e] hover:bg-[#f8f8f8]"
              >
                All Leagues
              </Link>
              {leagues.length > 0 && (
                <>
                  <div className="border-t border-[#f0f0f0] my-1" />
                  <div className="px-3 pt-1 pb-0.5 text-[9px] font-black uppercase tracking-widest text-[#c8c8c8]">
                    Switch League
                  </div>
                  <div className="max-h-60 overflow-y-auto">
                    {leagues.map(l => (
                      <Link
                        key={l.id}
                        href={`/league/${l.id}`}
                        onClick={() => setMenuOpen(false)}
                        className="block px-3 py-2 text-xs text-[#121212] hover:bg-[#f8f8f8] truncate"
                        title={l.name}
                      >
                        <span className="font-semibold">{l.name}</span>
                        <span className="ml-2 text-[9px] text-[#98989e] uppercase tracking-wide">{l.status}</span>
                      </Link>
                    ))}
                  </div>
                </>
              )}
              <div className="border-t border-[#f0f0f0] my-1" />
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
