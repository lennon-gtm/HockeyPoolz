'use client'
import { useState, useEffect, use } from 'react'
import { auth } from '@/lib/firebase/client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface Member {
  id: string; teamName: string; teamIcon: string | null
  draftPosition: number | null; autodraftEnabled: boolean
  user: { displayName: string; id: string }
}
interface LeagueDetail {
  id: string; name: string; inviteCode: string; status: string
  maxTeams: number; playersPerTeam: number
  commissioner: { displayName: string }
  commissionerId: string
  members: Member[]
}
interface Draft {
  id: string; status: string; currentPickNumber: number; isMock: boolean
  pickTimeLimitSecs: number
}

export default function LeagueLobbyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [league, setLeague] = useState<LeagueDetail | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [orderLoading, setOrderLoading] = useState(false)
  const [startLoading, setStartLoading] = useState(false)
  const [autodraftLoading, setAutodraftLoading] = useState(false)
  const [error, setError] = useState('')

  async function getToken() { return await auth.currentUser?.getIdToken() ?? '' }

  useEffect(() => {
    async function load() {
      const token = await getToken()
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {}

      const [leagueRes, meRes, draftRes] = await Promise.all([
        fetch(`/api/leagues/${id}`, { headers }),
        token ? fetch('/api/auth/me', { headers }) : Promise.resolve(null),
        fetch(`/api/leagues/${id}/draft`, { headers }),
      ])

      if (leagueRes.ok) {
        const data = await leagueRes.json()
        setLeague(data.league)
      }
      if (meRes?.ok) {
        const data = await meRes.json()
        setMyUserId(data.user.id)
      }
      if (draftRes.ok) {
        const data = await draftRes.json()
        setDraft(data.draft)
      }
    }
    load()
  }, [id])

  if (!league) return <div className="p-6 text-gray-400 text-sm">Loading…</div>

  const isCommissioner = myUserId === league.commissionerId
  const myMember = league.members.find(m => m.user.id === myUserId)
  const inviteUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/join/${league.inviteCode}`
  const allHavePositions = league.members.every(m => m.draftPosition !== null)
  const sortedMembers = [...league.members].sort((a, b) => (a.draftPosition ?? 999) - (b.draftPosition ?? 999))

  function copyLink() {
    navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function randomizeOrder() {
    setOrderLoading(true)
    setError('')
    try {
      const token = await getToken()
      const res = await fetch(`/api/leagues/${id}/draft/order`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ randomize: true }),
      })
      if (!res.ok) { setError('Failed to randomize order'); return }
      // Reload league data
      const leagueRes = await fetch(`/api/leagues/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      if (leagueRes.ok) setLeague((await leagueRes.json()).league)
    } finally { setOrderLoading(false) }
  }

  async function createAndStartDraft() {
    setStartLoading(true)
    setError('')
    try {
      const token = await getToken()
      // Create draft if none exists
      if (!draft) {
        const res = await fetch(`/api/leagues/${id}/draft`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        if (!res.ok) { setError('Failed to create draft'); return }
        const data = await res.json()
        setDraft(data.draft)
      }
      // Start draft
      const res = await fetch(`/api/leagues/${id}/draft`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Failed to start draft')
        return
      }
      router.push(`/league/${id}/draft`)
    } finally { setStartLoading(false) }
  }

  async function toggleAutodraft() {
    if (!myMember) return
    setAutodraftLoading(true)
    try {
      const token = await getToken()
      await fetch(`/api/leagues/${id}/draft/settings`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ autodraftEnabled: !myMember.autodraftEnabled }),
      })
      // Reload
      const res = await fetch(`/api/leagues/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) setLeague((await res.json()).league)
    } finally { setAutodraftLoading(false) }
  }

  const draftActive = draft?.status === 'active' || draft?.status === 'paused'

  return (
    <div className="min-h-screen bg-white p-6 max-w-lg mx-auto">
      <h1 className="text-2xl font-black mb-1">{league.name}</h1>
      <p className="text-gray-500 text-sm mb-6">{league.members.length}/{league.maxTeams} teams · {league.playersPerTeam} players per team</p>

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      {/* Draft status banner */}
      {draftActive && (
        <div className="bg-orange-50 border-2 border-orange-300 rounded-xl p-4 mb-6">
          <p className="font-bold text-orange-800 text-sm">Draft is {draft!.status}!</p>
          <Link href={`/league/${id}/draft`}
            className="mt-2 inline-block bg-orange-500 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-orange-600 transition">
            Go to Draft Room →
          </Link>
        </div>
      )}

      {/* Invite link */}
      {league.status === 'setup' && (
        <div className="bg-gray-50 rounded-xl p-4 mb-6">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Invite Link</p>
          <p className="text-sm text-gray-600 break-all mb-3">{inviteUrl}</p>
          <button onClick={copyLink}
            className="bg-orange-500 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-orange-600 transition">
            {copied ? '✓ Copied!' : 'Copy Link'}
          </button>
        </div>
      )}

      {/* Draft order (setup phase) */}
      {league.status === 'setup' && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Draft Order</p>
            {isCommissioner && (
              <button onClick={randomizeOrder} disabled={orderLoading}
                className="text-xs text-orange-500 font-bold hover:text-orange-700 disabled:opacity-50">
                {orderLoading ? 'Shuffling…' : '🔀 Randomize'}
              </button>
            )}
          </div>
          {sortedMembers.map((m, i) => (
            <div key={m.id} className="flex items-center gap-3 p-3 border-b border-gray-100">
              <span className="text-sm font-black text-gray-400 w-6 text-right">
                {m.draftPosition ?? '—'}
              </span>
              <span className="text-xl">{m.teamIcon ?? '🏒'}</span>
              <div className="flex-1">
                <p className="font-semibold text-sm">{m.teamName}</p>
                <p className="text-xs text-gray-400">{m.user.displayName}</p>
              </div>
              {m.autodraftEnabled && (
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-bold">AUTO</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* My autodraft toggle */}
      {myMember && league.status === 'setup' && (
        <div className="bg-blue-50 rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-bold text-sm">Autodraft</p>
              <p className="text-xs text-gray-500">Can&apos;t make it? We&apos;ll pick for you by ADP.</p>
            </div>
            <button
              onClick={toggleAutodraft}
              disabled={autodraftLoading}
              className={`w-12 h-6 rounded-full transition-colors ${myMember.autodraftEnabled ? 'bg-blue-500' : 'bg-gray-300'} disabled:opacity-50`}
            >
              <span className={`block w-5 h-5 bg-white rounded-full shadow transition-transform mx-0.5 ${myMember.autodraftEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
            </button>
          </div>
        </div>
      )}

      {/* Members list (draft/active phase) */}
      {league.status !== 'setup' && (
        <>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Teams ({league.members.length})</p>
          {sortedMembers.map(m => (
            <div key={m.id} className="flex items-center gap-3 p-3 border-b border-gray-100">
              <span className="text-2xl">{m.teamIcon ?? '🏒'}</span>
              <div>
                <p className="font-semibold text-sm">{m.teamName}</p>
                <p className="text-xs text-gray-400">{m.user.displayName}</p>
              </div>
            </div>
          ))}
        </>
      )}

      {/* Commissioner controls */}
      <div className="mt-6 flex gap-3 flex-wrap">
        <Link href={`/league/${id}/settings`}
          className="flex-1 text-center py-3 border-2 border-gray-200 rounded-xl text-sm font-bold hover:border-gray-400 transition">
          Scoring Settings
        </Link>
        {isCommissioner && league.status === 'setup' && !draftActive && (
          <button
            onClick={createAndStartDraft}
            disabled={startLoading || !allHavePositions}
            className="flex-1 py-3 bg-orange-500 text-white rounded-xl text-sm font-bold hover:bg-orange-600 disabled:opacity-50 transition"
            title={!allHavePositions ? 'Randomize draft order first' : ''}
          >
            {startLoading ? 'Starting…' : '🚀 Start Draft'}
          </button>
        )}
      </div>
    </div>
  )
}
