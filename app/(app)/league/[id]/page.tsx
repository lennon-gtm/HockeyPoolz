'use client'
import { useState, useEffect, use } from 'react'
import { auth } from '@/lib/firebase/client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { TeamIcon } from '@/components/team-icon'
import { StatCard } from '@/components/stat-card'

interface Member {
  id: string; teamName: string; teamIcon: string | null
  draftPosition: number | null; autodraftEnabled: boolean
  user: { displayName: string; id: string }
  favoriteTeam?: { colorPrimary: string; colorSecondary: string; name: string } | null
}
interface LeagueDetail {
  id: string; name: string; inviteCode: string; status: string
  maxTeams: number
  rosterForwards: number; rosterDefense: number; rosterGoalies: number
  commissioner: { displayName: string }
  commissionerId: string
  members: Member[]
}
interface Draft {
  id: string; status: string; currentPickNumber: number; isMock: boolean
  pickTimeLimitSecs: number
  scheduledStartAt: string | null
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
  const [standings, setStandings] = useState<{ rank: number; memberId: string; teamName: string; teamIcon: string | null; userName: string; totalScore: number }[]>([])
  const [recap, setRecap] = useState<{ id: string; recapDate: string; content: string; standingChange: number; createdAt: string } | null>(null)
  const [recapExpanded, setRecapExpanded] = useState(false)

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
        const leagueData = await leagueRes.json()
        setLeague(leagueData.league)
        if (leagueData.league.status === 'active' || leagueData.league.status === 'complete') {
          const standingsRes = await fetch(`/api/leagues/${id}/standings`, { headers })
          if (standingsRes.ok) {
            const standingsData = await standingsRes.json()
            setStandings(standingsData.standings)
          }
          // Fetch latest recap
          const recapRes = await fetch(`/api/leagues/${id}/recaps`, { headers })
          if (recapRes.ok) {
            const recapData = await recapRes.json()
            setRecap(recapData.recap)
          }
        }
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
  const myColor = myMember?.favoriteTeam?.colorPrimary ?? '#FF6B00'
  const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? (typeof window !== 'undefined' ? window.location.origin : '')}/join/${league.inviteCode}`
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
    <div className="bg-white min-h-screen">
      <div className="p-4 max-w-xl mx-auto">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-xl font-black tracking-tight text-[#121212]">{league.name}</h1>
          <p className="text-xs text-[#98989e] font-semibold mt-0.5">
            {isCommissioner ? '👑 Commissioner · ' : ''}{league.members.length}/{league.maxTeams} Teams · {league.status === 'setup' ? 'Setup' : league.status === 'draft' ? 'Drafting' : league.status === 'active' ? 'Active' : 'Complete'}
          </p>
        </div>
        <Link
          href={`/league/${id}/draft-settings`}
          className="w-9 h-9 flex items-center justify-center rounded-full border border-[#eeeeee] text-[#515151] hover:border-gray-400 hover:text-[#121212] transition"
          aria-label="Draft settings"
        >
          ⚙
        </Link>
      </div>

      {league.status === 'setup' && (
        <div className="grid grid-cols-3 gap-1.5 mb-4">
          <StatCard value={`${league.members.length}/${league.maxTeams}`} label="Teams" />
          <StatCard value={formatDraftCell(draft?.scheduledStartAt ?? null)} label="Draft" />
          <StatCard value={`${draft?.pickTimeLimitSecs ?? 90}s`} label="Per Pick" />
        </div>
      )}

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      {/* Draft status banner */}
      {draftActive && (
        <div className="bg-orange-50 border-2 border-orange-300 rounded-xl p-4 mb-6">
          <p className="font-bold text-orange-800 text-sm">Draft is {draft!.status}!</p>
          <Link href={`/league/${id}/draft`}
            style={{ backgroundColor: myColor }}
            className="mt-2 inline-block text-white px-4 py-2 rounded-lg text-sm font-bold hover:opacity-90 transition">
            Go to Draft Room →
          </Link>
        </div>
      )}

      {/* Draft order (setup phase) */}
      {league.status === 'setup' && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Draft Order</p>
          </div>
          {sortedMembers.map((m, i) => (
            <div key={m.id} className="flex items-center gap-3 p-3 border-b border-gray-100">
              <span className="text-sm font-black text-gray-400 w-6 text-right">
                {m.draftPosition ?? '—'}
              </span>
              <TeamIcon icon={m.teamIcon} />
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

      {/* Morning Recap card */}
      {recap && (league.status === 'active' || league.status === 'complete') && (
        <div className="bg-gray-50 rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Morning Recap</p>
              <span className="text-xs text-gray-400">{new Date(recap.recapDate).toLocaleDateString()}</span>
            </div>
            {recap.standingChange !== 0 && (
              <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                recap.standingChange > 0
                  ? 'bg-green-100 text-green-700'
                  : 'bg-red-100 text-red-700'
              }`}>
                {recap.standingChange > 0 ? '▲' : '▼'} {Math.abs(recap.standingChange)}
              </span>
            )}
          </div>
          <div className="text-sm text-gray-700 leading-relaxed">
            {recapExpanded
              ? recap.content
              : recap.content.split('\n\n')[0]
            }
          </div>
          {recap.content.includes('\n\n') && (
            <button
              onClick={() => setRecapExpanded(!recapExpanded)}
              className="text-xs text-orange-500 font-bold mt-2 hover:text-orange-700"
            >
              {recapExpanded ? 'Show less' : 'Read more'}
            </button>
          )}
        </div>
      )}

      {/* Standings summary (active/complete phase) */}
      {(league.status === 'active' || league.status === 'complete') && standings.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Standings</p>
            <Link href={`/league/${id}/standings`} className="text-xs text-orange-500 font-bold hover:text-orange-700">
              View Full Standings →
            </Link>
          </div>
          {standings.map(s => (
            <div key={s.memberId} className="flex items-center gap-3 p-3 border-b border-gray-100">
              <span className="text-sm font-black text-gray-400 w-6 text-right">{s.rank}</span>
              <TeamIcon icon={s.teamIcon} />
              <div className="flex-1">
                <p className="font-semibold text-sm">{s.teamName}</p>
                <p className="text-xs text-gray-400">{s.userName}</p>
              </div>
              <span className="text-sm font-bold text-orange-500">{s.totalScore.toFixed(1)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Members list (draft phase only) */}
      {league.status === 'draft' && (
        <>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Teams ({league.members.length})</p>
          {sortedMembers.map(m => (
            <div key={m.id} className="flex items-center gap-3 p-3 border-b border-gray-100">
              <TeamIcon icon={m.teamIcon} size="lg" />
              <div>
                <p className="font-semibold text-sm">{m.teamName}</p>
                <p className="text-xs text-gray-400">{m.user.displayName}</p>
              </div>
            </div>
          ))}
        </>
      )}

      {/* Commissioner controls (setup phase only) */}
      {isCommissioner && league.status === 'setup' && !draftActive && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            onClick={createAndStartDraft}
            disabled={startLoading || !allHavePositions}
            style={{ backgroundColor: myColor }}
            className="py-3 text-white rounded-xl text-sm font-bold hover:opacity-90 disabled:opacity-50 transition"
            title={!allHavePositions ? 'Randomize draft order first' : ''}
          >
            {startLoading ? 'Starting…' : '🚀 Start Draft'}
          </button>
          <button
            onClick={randomizeOrder}
            disabled={orderLoading}
            className="py-3 bg-[#f8f8f8] border-2 border-[#eeeeee] rounded-xl text-sm font-bold text-[#121212] hover:border-gray-400 transition disabled:opacity-50"
          >
            {orderLoading ? 'Shuffling…' : '🔀 Randomize'}
          </button>
        </div>
      )}

      {/* Invite link — below action buttons */}
      {league.status === 'setup' && (
        <div className="bg-gray-50 rounded-xl p-4 mt-4">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Invite Link</p>
          <p className="text-sm text-gray-600 break-all mb-3">{inviteUrl}</p>
          <button onClick={copyLink}
            style={{ backgroundColor: myColor }}
            className="text-white px-4 py-2 rounded-lg text-sm font-bold hover:opacity-90 transition">
            {copied ? '✓ Copied!' : 'Copy Link'}
          </button>
        </div>
      )}
      </div>
    </div>
  )
}

function formatDraftCell(iso: string | null): string {
  if (!iso) return '—'
  const target = new Date(iso).getTime()
  const diffMs = target - Date.now()
  if (diffMs <= 0) return 'Now'
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}
