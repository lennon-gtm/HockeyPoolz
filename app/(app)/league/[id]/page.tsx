'use client'
import { useState, useEffect, use } from 'react'
import { auth } from '@/lib/firebase/client'
import Link from 'next/link'

interface LeagueDetail {
  id: string; name: string; inviteCode: string; status: string
  maxTeams: number; playersPerTeam: number
  commissioner: { displayName: string }
  members: { id: string; teamName: string; teamIcon: string | null; user: { displayName: string } }[]
}

export default function LeagueLobbyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [league, setLeague] = useState<LeagueDetail | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    async function load() {
      const token = await auth.currentUser?.getIdToken()
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {}
      fetch(`/api/leagues/${id}`, { headers }).then(r => r.json()).then(d => setLeague(d.league))
    }
    load()
  }, [id])

  if (!league) return <div className="p-6 text-gray-400 text-sm">Loading…</div>

  const inviteUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/join/${league.inviteCode}`

  function copyLink() {
    navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="min-h-screen bg-white p-6 max-w-lg mx-auto">
      <h1 className="text-2xl font-black mb-1">{league.name}</h1>
      <p className="text-gray-500 text-sm mb-6">{league.members.length}/{league.maxTeams} teams · {league.playersPerTeam} players per team</p>

      <div className="bg-gray-50 rounded-xl p-4 mb-6">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Invite Link</p>
        <p className="text-sm text-gray-600 break-all mb-3">{inviteUrl}</p>
        <button onClick={copyLink}
          className="bg-orange-500 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-orange-600 transition">
          {copied ? '✓ Copied!' : 'Copy Link'}
        </button>
      </div>

      <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Teams ({league.members.length})</p>
      {league.members.map(m => (
        <div key={m.id} className="flex items-center gap-3 p-3 border-b border-gray-100">
          <span className="text-2xl">{m.teamIcon ?? '🏒'}</span>
          <div>
            <p className="font-semibold text-sm">{m.teamName}</p>
            <p className="text-xs text-gray-400">{m.user.displayName}</p>
          </div>
        </div>
      ))}

      <div className="mt-6 flex gap-3">
        <Link href={`/league/${id}/settings`}
          className="flex-1 text-center py-3 border-2 border-gray-200 rounded-xl text-sm font-bold hover:border-gray-400 transition">
          Scoring Settings
        </Link>
      </div>
    </div>
  )
}
