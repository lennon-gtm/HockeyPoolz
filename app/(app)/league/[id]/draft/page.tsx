'use client'
import { useState, useEffect, useCallback, use } from 'react'
import { auth } from '@/lib/firebase/client'
import { useRouter } from 'next/navigation'
import { TeamIcon } from '@/components/team-icon'
import { PositionBadge } from '@/components/position-badge'

function toBucket(pos: string): 'F' | 'D' | 'G' {
  if (pos === 'G') return 'G'
  if (pos === 'D') return 'D'
  return 'F'
}

interface Player {
  id: number; name: string; position: string; teamId: string; headshotUrl: string | null
  team?: { id: string; name: string; colorPrimary: string }
}
interface Pick {
  pickNumber: number; round: number
  leagueMemberId: string; teamName: string; teamIcon: string | null
  player: { id: number; name: string; position: string; teamId: string; headshotUrl: string | null }
  pickSource: string; pickedAt: string
}
interface MemberSummary {
  leagueMemberId: string; teamName: string; teamIcon: string | null
  draftPosition: number; pickCount: number; autodraftEnabled: boolean; isCommissioner: boolean
}
interface DraftState {
  draft: {
    id: string; status: string; currentPickNumber: number; totalPicks: number
    pickDeadline: string | null; pickTimeLimitSecs: number; isMock: boolean
    scheduledStartAt: string | null
  } | null
  currentPicker: {
    leagueMemberId: string; teamName: string; teamIcon: string | null
    isMe: boolean; autodraftEnabled: boolean; colorPrimary: string | null
  } | null
  picks: Pick[]
  members: MemberSummary[]
  myLeagueMemberId: string | null
  isCommissioner: boolean
  myColor: string | null
}

const POSITIONS = ['All', 'C', 'LW', 'RW', 'D', 'G']

export default function DraftRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = use(params)
  const router = useRouter()
  const [state, setState] = useState<DraftState | null>(null)
  const [players, setPlayers] = useState<Player[]>([])
  const [posFilter, setPosFilter] = useState('All')
  const [search, setSearch] = useState('')
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const [pickLoading, setPickLoading] = useState(false)
  const [error, setError] = useState('')
  const [preDraftTab, setPreDraftTab] = useState<'rankings' | 'wishlist'>('rankings')
  const [autodraftEnabled, setAutodraftEnabled] = useState(false)

  async function getToken() { return await auth.currentUser?.getIdToken() ?? '' }

  const fetchState = useCallback(async () => {
    const token = await getToken()
    const res = await fetch(`/api/leagues/${leagueId}/draft/state`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return
    const data: DraftState = await res.json()
    setState(data)
  }, [leagueId])

  const fetchPlayers = useCallback(async () => {
    if (!state?.draft) return
    const token = await getToken()
    const pos = posFilter !== 'All' ? `&position=${posFilter}` : ''
    const q = search ? `&search=${encodeURIComponent(search)}` : ''
    const res = await fetch(
      `/api/nhl-players?draftId=${state.draft.id}${pos}${q}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (res.ok) {
      const data = await res.json()
      setPlayers(data.players)
    }
  }, [state?.draft, posFilter, search])

  // Poll draft state every 5 seconds
  useEffect(() => {
    fetchState()
    const interval = setInterval(fetchState, 5000)
    return () => clearInterval(interval)
  }, [fetchState])

  // Fetch players when draft or filters change
  useEffect(() => { fetchPlayers() }, [fetchPlayers])

  // Countdown timer
  useEffect(() => {
    if (!state?.draft?.pickDeadline || state.draft.status !== 'active') {
      setSecondsLeft(null)
      return
    }
    const deadline = new Date(state.draft.pickDeadline).getTime()

    function tick() {
      const secs = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      setSecondsLeft(secs)
      if (secs === 0) triggerAutoPickExpired()
    }

    tick()
    const interval = setInterval(tick, 500)
    return () => clearInterval(interval)
  }, [state?.draft?.pickDeadline, state?.draft?.status])

  async function triggerAutoPickExpired() {
    const token = await getToken()
    await fetch(`/api/leagues/${leagueId}/draft/pick`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoPickExpired: true }),
    })
    fetchState()
  }

  async function makePick(playerId: number) {
    setPickLoading(true)
    setError('')
    try {
      const token = await getToken()
      const res = await fetch(`/api/leagues/${leagueId}/draft/pick`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Pick failed'); return }
      await fetchState()
      await fetchPlayers()
    } finally { setPickLoading(false) }
  }

  async function commissionerAction(action: 'pause' | 'resume') {
    const token = await getToken()
    await fetch(`/api/leagues/${leagueId}/draft`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    fetchState()
  }

  if (!state) return <div className="p-6 text-gray-400 text-sm">Loading draft…</div>
  if (!state.draft || state.draft.status === 'pending') {
    return (
      <PreDraft
        leagueId={leagueId}
        draft={state.draft}
        myColor={state.myColor ?? '#FF6B00'}
        preDraftTab={preDraftTab}
        setPreDraftTab={setPreDraftTab}
        autodraftEnabled={autodraftEnabled}
        setAutodraftEnabled={setAutodraftEnabled}
      />
    )
  }

  if (state.draft.status === 'complete') {
    return (
      <PostDraft
        draft={state.draft}
        picks={state.picks}
        members={state.members}
        myLeagueMemberId={state.myLeagueMemberId}
        myColor={state.myColor ?? '#FF6B00'}
      />
    )
  }

  const { draft, currentPicker, picks, members, myLeagueMemberId, isCommissioner } = state
  const isMyTurn = currentPicker?.isMe && draft.status === 'active'
  const myPicks = picks.filter(p => p.leagueMemberId === myLeagueMemberId)
  const timerPct = secondsLeft !== null ? (secondsLeft / draft.pickTimeLimitSecs) * 100 : 100
  const timerColor = secondsLeft !== null && secondsLeft <= 15 ? '#ef4444' : '#f97316'
  const pickerColor = currentPicker?.colorPrimary ?? '#FF6B00'

  return (
    <div className="bg-white min-h-screen">
      <div className="p-4 max-w-xl mx-auto">
      {/* Header */}
      <div className="border-b border-gray-200 pb-3 mb-3 flex items-center justify-between">
        <div>
          <h1 className="font-black text-lg tracking-wider">
            {draft.isMock ? '📋 MOCK DRAFT' : '🏒 DRAFT ROOM'}
          </h1>
          <p className="text-xs text-gray-500">
            Pick {draft.currentPickNumber} of {draft.totalPicks}
            {draft.status === 'paused' && ' · ⏸ PAUSED'}
            {draft.status === 'complete' && ' · ✓ COMPLETE'}
          </p>
        </div>
        {isCommissioner && draft.status === 'active' && (
          <button onClick={() => commissionerAction('pause')}
            className="text-xs border border-gray-300 px-3 py-1.5 rounded-lg font-bold hover:bg-gray-100">
            ⏸ Pause
          </button>
        )}
        {isCommissioner && draft.status === 'paused' && (
          <button onClick={() => commissionerAction('resume')}
            className="text-xs bg-orange-500 text-white px-3 py-1.5 rounded-lg font-bold hover:bg-orange-600">
            ▶ Resume
          </button>
        )}
      </div>

      {/* Current pick + timer */}
      {currentPicker && draft.status === 'active' && (
        <div className="mb-3">
          <div
            style={{ backgroundColor: pickerColor + '20', borderColor: pickerColor }}
            className="border-2 rounded-xl p-3 mb-2"
          >
            <div className="text-[9px] font-bold text-[#98989e] uppercase tracking-widest mb-1.5">
              On the Clock · Pick {draft.currentPickNumber}
            </div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">On the clock: </span>
                <TeamIcon icon={currentPicker.teamIcon} />
                <span className="font-bold text-sm">
                  {currentPicker.teamName}
                  {currentPicker.isMe && ' (YOU)'}
                  {currentPicker.autodraftEnabled && ' 🤖'}
                </span>
              </div>
              {secondsLeft !== null && (
                <span className="font-black text-xl" style={{ color: timerColor }}>
                  {secondsLeft}s
                </span>
              )}
            </div>
            {secondsLeft !== null && (
              <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${timerPct}%`, backgroundColor: timerColor }}
                />
              </div>
            )}
            {isMyTurn && (
              <p className="text-xs font-bold mt-2" style={{ color: pickerColor }}>⬇ Your pick — select a player below</p>
            )}
          </div>
        </div>
      )}

      {error && <p className="text-red-600 text-sm px-4 py-2">{error}</p>}

      <div className="flex gap-0 h-[calc(100vh-200px)]">
        {/* Left panel: available players */}
        <div className="flex-1 overflow-y-auto border-r border-gray-200 bg-white">
          <div className="p-3 border-b border-gray-100 sticky top-0 bg-white z-10">
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-2"
              placeholder="Search players…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <div className="flex gap-1 flex-wrap">
              {POSITIONS.map(pos => (
                <button key={pos}
                  onClick={() => setPosFilter(pos)}
                  className={`text-xs px-2 py-1 rounded font-bold transition ${posFilter === pos ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  {pos}
                </button>
              ))}
            </div>
          </div>

          {players.map(player => (
            <div key={player.id}
              className="flex items-center gap-3 px-3 py-2.5 border-b border-gray-50 hover:bg-orange-50 transition">
              <div className="w-8 h-8 rounded-full bg-gray-200 flex-shrink-0 overflow-hidden">
                {player.headshotUrl
                  ? <img src={player.headshotUrl} alt={player.name} className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center text-xs font-bold text-gray-500">{player.position}</div>
                }
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-semibold truncate">{player.name}</p>
                  <PositionBadge position={toBucket(player.position)} />
                </div>
                <p className="text-xs text-gray-400">{player.teamId}</p>
              </div>
              {isMyTurn && !pickLoading && (
                <button
                  onClick={() => makePick(player.id)}
                  className="text-xs text-white px-3 py-1 rounded-lg font-bold flex-shrink-0"
                  style={{ backgroundColor: pickerColor }}
                >
                  Draft
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Right panel: my picks + all picks */}
        <div className="w-64 overflow-y-auto bg-white">
          <div className="p-3 border-b border-gray-100">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">My Picks ({myPicks.length})</p>
            {myPicks.length === 0
              ? <p className="text-xs text-gray-400">No picks yet</p>
              : myPicks.map(p => (
                <div key={p.pickNumber} className="flex items-center gap-2 py-1.5 border-b border-gray-50">
                  <span className="text-xs text-gray-400 w-5">R{p.round}</span>
                  <div>
                    <div className="flex items-center gap-1">
                      <p className="text-xs font-semibold">{p.player.name}</p>
                      <PositionBadge position={toBucket(p.player.position)} />
                    </div>
                    <p className="text-xs text-gray-400">{p.player.teamId}</p>
                  </div>
                </div>
              ))
            }
          </div>

          <div className="p-3">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">All Picks</p>
            {picks.slice(-20).reverse().map(p => (
              <div key={p.pickNumber} className="flex items-start gap-2 py-1.5 border-b border-gray-50">
                <span className="text-xs text-gray-400 w-10 flex-shrink-0">#{p.pickNumber}</span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold truncate">{p.player.name}</p>
                  <p className="text-xs text-gray-400 truncate">{p.teamName}</p>
                  {p.pickSource !== 'manual' && (
                    <span className="text-xs text-blue-500 font-bold">AUTO</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}

// ── Interfaces ────────────────────────────────────────────────────────────────

interface RankedPlayer {
  id: number; name: string; position: string; adp: number | null; headshotUrl: string | null
  team: { id: string; name: string; colorPrimary: string } | null
  totals: { goals: number; assists: number; plusMinus: number; pim: number; shots: number
            goalieWins: number; goalieSaves: number; goalsAgainst: number; shutouts: number }
  proj: number
}

interface WishlistEntry {
  id: string; playerId: number; rank: number
  player: { id: number; name: string; position: string; adp: number | null
            team: { id: string; name: string } | null; proj?: number }
}

interface PreDraftProps {
  leagueId: string
  draft: DraftState['draft']
  myColor: string
  preDraftTab: 'rankings' | 'wishlist'
  setPreDraftTab: (t: 'rankings' | 'wishlist') => void
  autodraftEnabled: boolean
  setAutodraftEnabled: (v: boolean) => void
}

interface PostDraftProps {
  draft: NonNullable<DraftState['draft']>
  picks: Pick[]
  members: MemberSummary[]
  myLeagueMemberId: string | null
  myColor: string
}

// ── PreDraft ──────────────────────────────────────────────────────────────────

function PreDraft({
  leagueId, draft, myColor,
  preDraftTab, setPreDraftTab,
  autodraftEnabled, setAutodraftEnabled,
}: PreDraftProps) {
  const [wishlistCount, setWishlistCount] = useState(0)
  const [countdown, setCountdown] = useState('TBD')
  const [rankMode, setRankMode] = useState<'scoring' | 'adp'>('scoring')
  const [rankPos, setRankPos] = useState<'ALL' | 'F' | 'D' | 'G'>('ALL')
  const [rankSearch, setRankSearch] = useState('')
  const [rankPlayers, setRankPlayers] = useState<RankedPlayer[]>([])
  const [rankLoading, setRankLoading] = useState(false)
  const [wishlistIds, setWishlistIds] = useState<Set<number>>(new Set())
  const [wishlist, setWishlist] = useState<WishlistEntry[]>([])
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  useEffect(() => {
    if (!draft?.scheduledStartAt) { setCountdown('TBD'); return }
    function tick() {
      const ms = new Date(draft!.scheduledStartAt!).getTime() - Date.now()
      if (ms <= 0) { setCountdown('Starting soon'); return }
      const d = Math.floor(ms / 86400000)
      const h = Math.floor((ms % 86400000) / 3600000)
      const m = Math.floor((ms % 3600000) / 60000)
      setCountdown(d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`)
    }
    tick()
    const interval = setInterval(tick, 30000)
    return () => clearInterval(interval)
  }, [draft?.scheduledStartAt])

  useEffect(() => {
    async function loadCount() {
      const token = await auth.currentUser?.getIdToken()
      if (!token) return
      const res = await fetch(`/api/leagues/${leagueId}/draft/wishlist`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setWishlistCount(data.wishlist?.length ?? 0)
        setWishlistIds(new Set((data.wishlist ?? []).map((w: { playerId: number }) => w.playerId)))
      }
    }
    loadCount()
  }, [leagueId])

  async function loadWishlist() {
    const token = await auth.currentUser?.getIdToken()
    if (!token) return
    const res = await fetch(`/api/leagues/${leagueId}/draft/wishlist`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return
    const data = await res.json()
    const entries: WishlistEntry[] = data.wishlist ?? []
    setWishlist(entries)
    setWishlistIds(new Set(entries.map(e => e.playerId)))
    setWishlistCount(entries.length)
  }

  async function saveWishlistOrder(reordered: WishlistEntry[]) {
    const token = await auth.currentUser?.getIdToken()
    if (!token) return
    await fetch(`/api/leagues/${leagueId}/draft/wishlist`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wishlist: reordered.map((e, i) => ({ playerId: e.playerId, rank: i + 1 })),
      }),
    })
  }

  useEffect(() => {
    if (preDraftTab === 'wishlist') loadWishlist()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preDraftTab, leagueId])

  useEffect(() => {
    if (preDraftTab !== 'rankings') return
    let cancelled = false
    async function fetchRankings() {
      setRankLoading(true)
      const token = await auth.currentUser?.getIdToken()
      if (!token) return
      const qs = new URLSearchParams({
        mode: rankMode,
        ...(rankPos !== 'ALL' ? { position: rankPos } : {}),
        ...(rankSearch ? { search: rankSearch } : {}),
      })
      const res = await fetch(`/api/leagues/${leagueId}/draft/rankings?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok && !cancelled) {
        const data = await res.json()
        setRankPlayers(data.players ?? [])
      }
      if (!cancelled) setRankLoading(false)
    }
    fetchRankings()
    return () => { cancelled = true }
  }, [leagueId, preDraftTab, rankMode, rankPos, rankSearch])

  async function toggleAutodraft(enabled: boolean) {
    const token = await auth.currentUser?.getIdToken()
    if (!token) return
    await fetch(`/api/leagues/${leagueId}/draft/settings`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ autodraftEnabled: enabled }),
    })
    setAutodraftEnabled(enabled)
  }

  async function toggleWishlist(playerId: number) {
    const token = await auth.currentUser?.getIdToken()
    if (!token) return
    const isInWishlist = wishlistIds.has(playerId)
    if (isInWishlist) {
      const res = await fetch(`/api/leagues/${leagueId}/draft/wishlist`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return
      const data = await res.json()
      const newList = (data.wishlist ?? [])
        .filter((w: { playerId: number }) => w.playerId !== playerId)
        .map((w: { playerId: number }, i: number) => ({ playerId: w.playerId, rank: i + 1 }))
      await fetch(`/api/leagues/${leagueId}/draft/wishlist`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ wishlist: newList }),
      })
      setWishlistIds(prev => { const s = new Set(prev); s.delete(playerId); return s })
      setWishlistCount(c => Math.max(0, c - 1))
    } else {
      await fetch(`/api/leagues/${leagueId}/draft/wishlist`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId }),
      })
      setWishlistIds(prev => new Set([...prev, playerId]))
      setWishlistCount(c => c + 1)
    }
  }

  const draftDateStr = draft?.scheduledStartAt
    ? new Date(draft.scheduledStartAt).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      })
    : null

  return (
    <div className="bg-white min-h-screen">
      <div className="p-4 max-w-xl mx-auto">
        {/* Countdown card */}
        <div
          className="rounded-xl p-4 mb-4 flex items-center justify-between"
          style={{ backgroundColor: myColor + '18', borderLeft: `3px solid ${myColor}` }}
        >
          <div>
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#98989e] mb-0.5">Draft Starts In</p>
            <p className="text-2xl font-black tracking-tight text-[#121212]">{countdown}</p>
            {draftDateStr && <p className="text-xs text-[#98989e] font-semibold mt-0.5">{draftDateStr}</p>}
          </div>
          <div className="text-right">
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#98989e] mb-1">Autodraft</p>
            <button
              onClick={() => toggleAutodraft(!autodraftEnabled)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${autodraftEnabled ? 'bg-orange-500' : 'bg-gray-200'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${autodraftEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
            <p className="text-[9px] text-[#98989e] mt-0.5">{autodraftEnabled ? "On — we'll pick by ADP" : 'Off'}</p>
          </div>
        </div>

        {/* Sub-tabs */}
        <div className="flex border-b border-[#eeeeee] mb-4">
          {(['rankings', 'wishlist'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setPreDraftTab(tab)}
              className={`px-4 py-2 text-xs font-bold transition flex items-center gap-1.5 ${
                preDraftTab === tab ? 'border-b-2 text-[#121212]' : 'text-[#98989e] hover:text-[#515151]'
              }`}
              style={preDraftTab === tab ? { borderBottomColor: myColor } : {}}
            >
              {tab === 'rankings' ? 'RANKINGS' : 'MY WISHLIST'}
              {tab === 'wishlist' && wishlistCount > 0 && (
                <span
                  className="text-[9px] font-bold text-white rounded-full w-4 h-4 flex items-center justify-center"
                  style={{ backgroundColor: myColor }}
                >
                  {wishlistCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content — Rankings (Task 3) and Wishlist (Task 4) */}
        {preDraftTab === 'rankings' && (
          <div>
            {/* Mode toggle */}
            <div className="flex gap-2 mb-3">
              {(['scoring', 'adp'] as const).map(m => (
                <button key={m} onClick={() => setRankMode(m)}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition ${rankMode === m ? 'text-white' : 'bg-[#f8f8f8] text-[#515151] hover:bg-gray-200'}`}
                  style={rankMode === m ? { backgroundColor: myColor } : {}}
                >
                  {m === 'scoring' ? 'MY SCORING' : 'ADP'}
                </button>
              ))}
            </div>

            {/* Position + search filters */}
            <div className="flex gap-2 mb-3 flex-wrap items-center">
              {(['ALL', 'F', 'D', 'G'] as const).map(p => (
                <button key={p} onClick={() => setRankPos(p)}
                  className={`px-2.5 py-1 text-xs font-bold rounded transition ${rankPos === p ? 'text-white' : 'bg-[#f8f8f8] text-[#515151] hover:bg-gray-200'}`}
                  style={rankPos === p ? { backgroundColor: myColor } : {}}
                >
                  {p}
                </button>
              ))}
              <input value={rankSearch} onChange={e => setRankSearch(e.target.value)}
                placeholder="Search…"
                className="ml-auto border border-[#eeeeee] rounded-lg px-3 py-1 text-xs w-28"
              />
            </div>

            {/* Table */}
            {rankLoading ? (
              <p className="text-sm text-[#98989e] py-4">Loading…</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-[#eeeeee]">
                <table className="text-xs w-full">
                  <thead>
                    <tr className="bg-[#f8f8f8] text-[#98989e]">
                      <th className="sticky left-0 z-20 bg-[#f8f8f8] px-3 py-2 text-left font-bold uppercase tracking-widest text-[10px] min-w-[160px] border-r border-[#eeeeee]">Player</th>
                      <th className="px-3 py-2 text-right font-bold uppercase tracking-widest text-[10px] bg-[#eef3ff] text-[#0042bb] whitespace-nowrap">{rankMode === 'scoring' ? 'PROJ ↓' : 'ADP ↓'}</th>
                      <th className="px-3 py-2 text-right font-bold uppercase tracking-widest text-[10px]">G</th>
                      <th className="px-3 py-2 text-right font-bold uppercase tracking-widest text-[10px]">A</th>
                      <th className="px-3 py-2 text-right font-bold uppercase tracking-widest text-[10px]">PTS</th>
                      <th className="px-3 py-2 text-right font-bold uppercase tracking-widest text-[10px]">+/-</th>
                      <th className="px-3 py-2 text-right font-bold uppercase tracking-widest text-[10px] whitespace-nowrap">SOG</th>
                      <th className="px-2 py-2 text-center font-bold uppercase tracking-widest text-[10px]">★</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rankPlayers.map((player, i) => {
                      const isGoalie = player.position === 'G'
                      const inWishlist = wishlistIds.has(player.id)
                      const rowBg = i % 2 === 1 ? '#fafafa' : '#ffffff'
                      return (
                        <tr key={player.id} className="border-t border-[#eeeeee]" style={{ backgroundColor: rowBg }}>
                          <td className="sticky left-0 z-10 px-3 py-2 border-r border-[#eeeeee]" style={{ backgroundColor: rowBg }}>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-[#98989e] w-5 text-right flex-shrink-0">{i + 1}</span>
                              <div className="w-7 h-7 rounded-full bg-gray-100 flex-shrink-0 overflow-hidden">
                                {player.headshotUrl
                                  ? <img src={player.headshotUrl} alt="" className="w-full h-full object-cover" />
                                  : <div className="w-full h-full flex items-center justify-center text-[9px] text-gray-400">{player.position}</div>
                                }
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1">
                                  <span className="font-bold text-[#121212] truncate text-xs">{player.name}</span>
                                  <PositionBadge position={isGoalie ? 'G' : player.position === 'D' ? 'D' : 'F'} />
                                </div>
                                <span className="text-[10px] text-[#98989e]">{player.team?.id ?? '—'}</span>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right font-black text-[#0042bb] bg-[#eef3ff] whitespace-nowrap">
                            {rankMode === 'scoring' ? player.proj : (player.adp?.toFixed(1) ?? '—')}
                          </td>
                          <td className="px-3 py-2 text-right text-[#121212] font-semibold">
                            {isGoalie ? (player.totals.goalieWins || '—') : (player.totals.goals || '—')}
                          </td>
                          <td className="px-3 py-2 text-right text-[#121212] font-semibold">
                            {isGoalie ? '—' : (player.totals.assists || '—')}
                          </td>
                          <td className="px-3 py-2 text-right text-[#121212] font-semibold">
                            {isGoalie ? '—' : ((player.totals.goals + player.totals.assists) || '—')}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold"
                            style={{ color: isGoalie ? '#98989e' : player.totals.plusMinus >= 0 ? '#2db944' : '#c8102e' }}>
                            {isGoalie ? '—' : (player.totals.plusMinus > 0 ? `+${player.totals.plusMinus}` : player.totals.plusMinus || '—')}
                          </td>
                          <td className="px-3 py-2 text-right text-[#121212] font-semibold">
                            {isGoalie ? (player.totals.goalieSaves || '—') : (player.totals.shots || '—')}
                          </td>
                          <td className="px-2 py-2 text-center">
                            <button onClick={() => toggleWishlist(player.id)}
                              className="text-base leading-none hover:scale-110 transition-transform"
                              style={{ color: inWishlist ? '#ffcf00' : '#d1d5db' }}
                            >★</button>
                          </td>
                        </tr>
                      )
                    })}
                    {rankPlayers.length === 0 && (
                      <tr><td colSpan={8} className="px-4 py-6 text-center text-sm text-[#98989e]">No players found</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        {preDraftTab === 'wishlist' && (
          <div>
            {wishlist.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-sm text-[#98989e] mb-4">No players on your wishlist yet.</p>
                <button onClick={() => setPreDraftTab('rankings')}
                  className="text-xs font-bold border-2 border-dashed border-[#eeeeee] rounded-xl px-6 py-3 text-[#98989e] hover:border-gray-300 hover:text-[#515151] transition">
                  ➕ Add players from Rankings
                </button>
              </div>
            ) : (
              <>
                <p className="text-[10px] text-[#98989e] font-semibold mb-3">
                  Drag to reorder. Autodraft picks in this order, skipping players already taken.
                </p>
                {wishlist.map((entry, i) => {
                  const isTop = i === 0
                  return (
                    <div key={entry.id}
                      draggable
                      onDragStart={() => setDragIndex(i)}
                      onDragOver={e => e.preventDefault()}
                      onDrop={() => {
                        if (dragIndex === null || dragIndex === i) return
                        const reordered = [...wishlist]
                        const [moved] = reordered.splice(dragIndex, 1)
                        reordered.splice(i, 0, moved)
                        setWishlist(reordered)
                        setDragIndex(null)
                        saveWishlistOrder(reordered)
                      }}
                      onDragEnd={() => setDragIndex(null)}
                      className={`flex items-center gap-3 py-3 border-b border-[#f5f5f5] cursor-grab select-none ${isTop ? 'bg-[#fff8f8]' : ''}`}
                      style={isTop ? { borderLeft: `3px solid ${myColor}`, paddingLeft: '12px' } : {}}
                    >
                      <span className="text-[#d1d5db] text-base leading-none flex-shrink-0">⋮⋮</span>
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0"
                        style={{ backgroundColor: isTop ? myColor : '#f0f0f0', color: isTop ? '#fff' : '#98989e' }}>
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-bold text-[#121212] truncate">{entry.player.name}</span>
                          <PositionBadge position={entry.player.position === 'G' ? 'G' : entry.player.position === 'D' ? 'D' : 'F'} />
                        </div>
                        <span className="text-[10px] text-[#98989e]">{entry.player.team?.id ?? '—'}</span>
                      </div>
                      <div className="flex gap-4 items-center flex-shrink-0">
                        {entry.player.proj !== undefined && (
                          <div className="text-right">
                            <div className="text-[10px] font-black bg-[#eef3ff] text-[#0042bb] px-2 py-0.5 rounded">{entry.player.proj.toFixed(1)}</div>
                            <div className="text-[9px] text-[#98989e] font-semibold text-center">PROJ</div>
                          </div>
                        )}
                        <div className="text-right">
                          <div className="text-xs font-bold text-[#121212]">{entry.player.adp?.toFixed(1) ?? '—'}</div>
                          <div className="text-[9px] text-[#98989e] font-semibold">ADP</div>
                        </div>
                        <button onClick={() => toggleWishlist(entry.playerId)}
                          className="text-[#98989e] hover:text-red-400 text-sm font-bold transition">
                          ✕
                        </button>
                      </div>
                    </div>
                  )
                })}
                <button onClick={() => setPreDraftTab('rankings')}
                  className="mt-4 w-full text-xs font-bold border-2 border-dashed border-[#eeeeee] rounded-xl px-4 py-3 text-[#98989e] hover:border-gray-300 hover:text-[#515151] transition">
                  ➕ Add players from Rankings
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── PostDraft stub (filled in Task 6) ─────────────────────────────────────────

function PostDraft({ draft: _draft, picks: _picks, members: _members, myLeagueMemberId: _myLeagueMemberId, myColor: _myColor }: PostDraftProps) {
  return (
    <div className="bg-white min-h-screen p-4 max-w-xl mx-auto">
      <p className="text-sm text-[#98989e]">Draft complete. History loading…</p>
    </div>
  )
}
