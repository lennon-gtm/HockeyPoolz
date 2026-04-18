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
  draftLobbyReady?: boolean
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
  const [readyLoading, setReadyLoading] = useState(false)
  const [error, setError] = useState('')
  const [pendingCount, setPendingCount] = useState(0)
  const [standings, setStandings] = useState<{
    rank: number; memberId: string; teamName: string; teamIcon: string | null
    userName: string; totalScore: number; yesterdayFpts: number | null
    colorPrimary: string | null
  }[]>([])
  const [myMemberId, setMyMemberId] = useState<string | null>(null)
  const [leagueRecap, setLeagueRecap] = useState<{ id: string; recapDate: string; content: string; createdAt: string } | null>(null)

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
            setMyMemberId(standingsData.myMemberId ?? null)
          }
        }
        // Fetch league bulletin whenever one may exist (survives a draft restart).
        const leagueRecapRes = await fetch(`/api/leagues/${id}/league-recap`, { headers })
        if (leagueRecapRes.ok) {
          const leagueRecapData = await leagueRecapRes.json()
          setLeagueRecap(leagueRecapData.recap)
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

      // Fetch pending join requests count (commissioner-only — endpoint returns 403 otherwise)
      if (leagueRes.ok) {
        const pendingRes = await fetch(`/api/leagues/${id}/join-requests`, { headers })
        if (pendingRes.ok) {
          const pendingData = await pendingRes.json()
          setPendingCount(pendingData.count ?? 0)
        }
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

  async function toggleReady() {
    if (!myMember) return
    setReadyLoading(true)
    try {
      const token = await getToken()
      await fetch(`/api/leagues/${id}/members/me`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftLobbyReady: !myMember.draftLobbyReady }),
      })
      const res = await fetch(`/api/leagues/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) setLeague((await res.json()).league)
    } finally { setReadyLoading(false) }
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

      {isCommissioner && pendingCount > 0 && league.status === 'setup' && (
        <Link
          href={`/league/${id}/join-requests`}
          className="block bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 mb-4 hover:bg-orange-100 transition"
        >
          <p className="text-sm font-bold text-[#121212]">
            🔔 {pendingCount} {pendingCount === 1 ? 'person is' : 'people are'} waiting to join
          </p>
          <p className="text-xs text-[#515151] mt-0.5">Tap to review →</p>
        </Link>
      )}

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

      {/* Draft lobby — readiness check-in (setup + live draft phases) */}
      {(league.status === 'setup' || league.status === 'draft') && (() => {
        const readyCount = sortedMembers.filter(m => m.draftLobbyReady).length
        return (
          <div className="mb-6 border border-[#eeeeee] rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#f5f5f5] bg-[#fafafa]">
              <div>
                <p className="text-[9px] font-black tracking-[2px] uppercase text-[#98989e]">Draft Lobby</p>
                <p className="text-sm font-bold text-[#121212] mt-0.5">
                  {readyCount} of {sortedMembers.length} ready
                </p>
              </div>
              {myMember && (
                <button
                  onClick={toggleReady}
                  disabled={readyLoading}
                  className={`px-4 py-2 rounded-lg text-xs font-bold transition disabled:opacity-50 ${
                    myMember.draftLobbyReady
                      ? 'bg-[#2db944] text-white hover:bg-[#259537]'
                      : 'bg-white text-[#121212] border-2 border-[#eeeeee] hover:border-gray-400'
                  }`}
                >
                  {readyLoading
                    ? 'Saving…'
                    : myMember.draftLobbyReady
                      ? '✓ I’m Ready'
                      : "I’m Ready"}
                </button>
              )}
            </div>
            <ul className="divide-y divide-[#f5f5f5]">
              {sortedMembers.map(m => (
                <li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="text-sm font-black text-gray-400 w-6 text-right">
                    {m.draftPosition ?? '—'}
                  </span>
                  <TeamIcon icon={m.teamIcon} />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{m.teamName}</p>
                    <p className="text-xs text-gray-400 truncate">{m.user.displayName}</p>
                  </div>
                  {m.autodraftEnabled && (
                    <span className="text-[9px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-bold">AUTO</span>
                  )}
                  {m.draftLobbyReady ? (
                    <span className="text-[9px] font-black text-[#2db944] bg-green-100 px-2 py-0.5 rounded uppercase tracking-widest">
                      Ready
                    </span>
                  ) : (
                    <span className="text-[9px] font-semibold text-[#98989e] uppercase tracking-widest">
                      Waiting
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )
      })()}

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

      {/* League Bulletin — always shown when one exists, regardless of league status. */}
      {leagueRecap && (
        <div className="bg-[#fff7ed] rounded-xl border border-[#fed7aa] p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[9px] font-black tracking-[2px] uppercase text-[#f97316]">📣 League Bulletin</span>
            <span className="text-[9px] text-[#fb923c] font-semibold">
              {league.status === 'draft'
                ? `Draft Day · ${new Date(leagueRecap.recapDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                : new Date(leagueRecap.recapDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
              }
            </span>
          </div>
          <p className="text-sm leading-relaxed text-[#431407]">{leagueRecap.content}</p>
        </div>
      )}

      {/* Active season — hero card + standings */}
      {(league.status === 'active' || league.status === 'complete') && standings.length > 0 && (() => {
        const mySt = standings.find(s => s.memberId === myMemberId)
        const sorted = [...standings].sort((a, b) => b.totalScore - a.totalScore)
        const lead = mySt
          ? mySt.rank === 1
            ? mySt.totalScore - (sorted[1]?.totalScore ?? 0)
            : mySt.totalScore - sorted[0].totalScore
          : null

        return (
          <>
            {/* Hero card */}
            {mySt && (
              <div
                className="bg-[#1a1a1a] rounded-xl p-4 mb-4"
                style={{ borderLeft: `4px solid ${mySt.colorPrimary ?? myColor}` }}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-white/60 mb-1">Your Standing</div>
                    <div className="text-3xl font-black text-white">{mySt.rank}{ordinalSuffix(mySt.rank)}</div>
                    <div className="text-xs text-white/70 mt-0.5">of {standings.length} teams</div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-black" style={{ color: mySt.colorPrimary ?? myColor }}>
                      {mySt.totalScore.toFixed(1)}
                    </div>
                    <div className="text-[9px] text-white/60 font-bold uppercase tracking-widest">Total FPTS</div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-white/10">
                  <div className="text-center">
                    <div className={`text-sm font-black ${mySt.yesterdayFpts !== null && mySt.yesterdayFpts > 0 ? 'text-[#2db944]' : 'text-white/50'}`}>
                      {mySt.yesterdayFpts !== null && mySt.yesterdayFpts > 0 ? `+${mySt.yesterdayFpts.toFixed(1)}` : mySt.yesterdayFpts === 0 ? '0.0' : '—'}
                    </div>
                    <div className="text-[9px] text-white/50 font-bold uppercase tracking-widest">Yesterday</div>
                  </div>
                  <div className="text-center">
                    <div className={`text-sm font-black ${lead !== null && lead > 0 ? 'text-[#2db944]' : lead !== null && lead < 0 ? 'text-[#c8102e]' : 'text-white/50'}`}>
                      {lead !== null ? (lead >= 0 ? `+${lead.toFixed(1)}` : lead.toFixed(1)) : '—'}
                    </div>
                    <div className="text-[9px] text-white/50 font-bold uppercase tracking-widest">
                      {mySt.rank === 1 ? 'Lead' : 'Deficit'}
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-sm font-black text-white">
                      {myMember ? league.rosterForwards + league.rosterDefense + league.rosterGoalies : '—'}
                    </div>
                    <div className="text-[9px] text-white/50 font-bold uppercase tracking-widest">Players</div>
                  </div>
                </div>
              </div>
            )}

            {/* Top-3 standings preview */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Standings</p>
                <Link href={`/league/${id}/standings`} className="text-xs text-orange-500 font-bold hover:text-orange-700">
                  View all →
                </Link>
              </div>
              <div className="flex items-center px-4 py-1.5 bg-[#f8f8f8] rounded-t-lg border border-b-0 border-[#eeeeee]">
                <span className="w-7 text-[9px] font-bold uppercase tracking-widest text-[#98989e] text-right">RK</span>
                <span className="w-6 mx-2" />
                <span className="flex-1 text-[9px] font-bold uppercase tracking-widest text-[#98989e]">Team</span>
                <span className="w-12 text-[9px] font-bold uppercase tracking-widest text-[#98989e] text-right">YDAY</span>
                <span className="w-14 text-[9px] font-bold uppercase tracking-widest text-[#0042bb] text-right">TOTAL</span>
              </div>
              <div className="border border-[#eeeeee] rounded-b-lg overflow-hidden">
                {standings.slice(0, 3).map(s => {
                  const isMe = s.memberId === myMemberId
                  return (
                    <div
                      key={s.memberId}
                      className="flex items-center px-4 py-3 border-b border-[#f5f5f5] last:border-0"
                      style={isMe ? { borderLeft: `3px solid ${s.colorPrimary ?? '#FF6B00'}`, backgroundColor: '#fff8f8' } : undefined}
                    >
                      <span className="w-7 text-sm font-black text-gray-300 text-right">{s.rank}</span>
                      <span className="mx-2"><TeamIcon icon={s.teamIcon} /></span>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm truncate">{s.teamName}</p>
                        <p className="text-xs text-gray-400 truncate">{s.userName}</p>
                      </div>
                      <span className="w-12 text-right text-xs font-semibold text-[#2db944]">
                        {s.yesterdayFpts !== null && s.yesterdayFpts > 0 ? `+${s.yesterdayFpts.toFixed(1)}` : s.yesterdayFpts === 0 ? '0.0' : '—'}
                      </span>
                      <span className="w-14 text-right text-sm font-black text-[#0042bb]">
                        {s.totalScore.toFixed(1)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        )
      })()}

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

function ordinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return s[(v - 20) % 10] ?? s[v] ?? s[0]
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
