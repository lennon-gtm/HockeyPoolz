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
  colorPrimary: string | null
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

const POSITIONS = ['All', 'F/D', 'F', 'D', 'G', 'C', 'LW', 'RW']

interface NhlTeam { id: string; abbreviation: string; colorPrimary: string }

export default function DraftRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = use(params)
  const router = useRouter()
  const [state, setState] = useState<DraftState | null>(null)
  const [players, setPlayers] = useState<Player[]>([])
  const [posFilter, setPosFilter] = useState('All')
  const [teamFilter, setTeamFilter] = useState('')
  const [teams, setTeams] = useState<NhlTeam[]>([])
  const [search, setSearch] = useState('')
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const [pickLoading, setPickLoading] = useState(false)
  const [error, setError] = useState('')
  const [rightTab, setRightTab] = useState<'mine' | 'board' | 'all'>('mine')
  const [expandedBoardMember, setExpandedBoardMember] = useState<string | null>(null)
  const [preDraftTab, setPreDraftTab] = useState<'rankings' | 'wishlist'>('rankings')
  const [autodraftEnabled, setAutodraftEnabled] = useState(false)
  const [liveAutodraft, setLiveAutodraft] = useState(false)
  const [autodraftSaving, setAutodraftSaving] = useState(false)

  async function getToken() { return await auth.currentUser?.getIdToken() ?? '' }

  const fetchState = useCallback(async () => {
    const token = await getToken()
    const res = await fetch(`/api/leagues/${leagueId}/draft/state`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return
    const data: DraftState = await res.json()
    setState(data)
    const myMemberData = data.members.find(m => m.leagueMemberId === data.myLeagueMemberId)
    if (myMemberData) {
      setLiveAutodraft(myMemberData.autodraftEnabled)
      setAutodraftEnabled(myMemberData.autodraftEnabled)
    }
  }, [leagueId])

  const fetchPlayers = useCallback(async () => {
    if (!state?.draft) return
    const token = await getToken()
    const apiPos = posFilter === 'F/D' ? 'FD' : posFilter
    const pos = apiPos !== 'All' ? `&position=${apiPos}` : ''
    const q = search ? `&search=${encodeURIComponent(search)}` : ''
    const team = teamFilter ? `&team=${teamFilter}` : ''
    const res = await fetch(
      `/api/nhl-players?draftId=${state.draft.id}${pos}${q}${team}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (res.ok) {
      const data = await res.json()
      setPlayers(data.players)
    }
  }, [state?.draft, posFilter, search, teamFilter])

  // Poll draft state every 5 seconds
  useEffect(() => {
    fetchState()
    const interval = setInterval(fetchState, 5000)
    return () => clearInterval(interval)
  }, [fetchState])

  // Fetch players when draft or filters change
  useEffect(() => { fetchPlayers() }, [fetchPlayers])

  // Load playoff teams for the team filter dropdown
  useEffect(() => {
    async function loadTeams() {
      const token = await getToken()
      const res = await fetch('/api/nhl-teams?playoffQualified=true', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setTeams(data.teams)
      }
    }
    loadTeams()
  }, [])

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

  async function toggleLiveAutodraft(enabled: boolean) {
    setAutodraftSaving(true)
    try {
      const token = await getToken()
      await fetch(`/api/leagues/${leagueId}/draft/settings`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ autodraftEnabled: enabled }),
      })
      setLiveAutodraft(enabled)
    } finally {
      setAutodraftSaving(false)
    }
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

      {/* Mid-draft autodraft toggle */}
      {state.myLeagueMemberId && (
        <div className="flex items-center justify-between px-3 py-2.5 bg-[#f8f8f8] rounded-xl mb-3">
          <div>
            <p className="text-xs font-bold text-[#121212]">
              {liveAutodraft ? '🤖 Autodraft on' : 'Autodraft off'}
            </p>
            <p className="text-[10px] text-[#98989e]">
              {liveAutodraft ? "We'll pick for you going forward" : "Switch on and we'll pick by ADP"}
            </p>
          </div>
          <button
            onClick={() => toggleLiveAutodraft(!liveAutodraft)}
            disabled={autodraftSaving}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${liveAutodraft ? 'bg-orange-500' : 'bg-gray-200'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${liveAutodraft ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
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
            <div className="flex gap-1 flex-wrap mb-2">
              {POSITIONS.map(pos => (
                <button key={pos}
                  onClick={() => setPosFilter(pos)}
                  className={`text-xs px-2 py-1 rounded font-bold transition ${posFilter === pos ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  {pos}
                </button>
              ))}
            </div>
            {teams.length > 0 && (
              <select
                value={teamFilter}
                onChange={e => setTeamFilter(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 bg-white"
              >
                <option value="">All Teams</option>
                {teams.map(t => (
                  <option key={t.id} value={t.id}>{t.abbreviation}</option>
                ))}
              </select>
            )}
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

        {/* Right panel: tabbed */}
        {(() => {
          const posCounts = { F: 0, D: 0, G: 0 }
          myPicks.forEach(p => { posCounts[toBucket(p.player.position)]++ })

          const boardData = members.map(m => {
            const mPicks = picks.filter(p => p.leagueMemberId === m.leagueMemberId)
            const counts = { F: 0, D: 0, G: 0 }
            mPicks.forEach(p => { counts[toBucket(p.player.position)]++ })
            return { ...m, counts, mPicks }
          }).sort((a, b) => a.draftPosition - b.draftPosition)

          return (
            <div className="w-64 flex flex-col bg-white border-l border-gray-100">
              {/* Tab bar */}
              <div className="flex border-b border-gray-100 sticky top-0 bg-white z-10 flex-shrink-0">
                {([['mine', 'Mine'], ['board', 'Board'], ['all', 'All']] as const).map(([key, label]) => (
                  <button key={key}
                    onClick={() => setRightTab(key)}
                    className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-wider transition ${
                      rightTab === key ? 'border-b-2 border-orange-500 text-orange-500' : 'text-gray-400 hover:text-gray-600'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="overflow-y-auto flex-1">
                {/* ── Mine tab ── */}
                {rightTab === 'mine' && (
                  <div className="p-3">
                    {/* Position breakdown */}
                    <div className="flex gap-1.5 mb-3">
                      {(['F', 'D', 'G'] as const).map(pos => (
                        <div key={pos} className="flex-1 bg-gray-50 rounded-lg py-1.5 text-center border border-gray-100">
                          <div className="text-sm font-black text-[#121212]">{posCounts[pos]}</div>
                          <div className="text-[9px] font-bold text-gray-400 uppercase">{pos}</div>
                        </div>
                      ))}
                    </div>
                    {myPicks.length === 0
                      ? <p className="text-xs text-gray-400">No picks yet</p>
                      : myPicks.map(p => (
                        <div key={p.pickNumber} className="flex items-center gap-2 py-1.5 border-b border-gray-50">
                          <span className="text-[10px] text-gray-400 w-5 flex-shrink-0">R{p.round}</span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1">
                              <p className="text-xs font-semibold truncate">{p.player.name}</p>
                              <PositionBadge position={toBucket(p.player.position)} />
                            </div>
                            <p className="text-[10px] text-gray-400">{p.player.teamId}</p>
                          </div>
                        </div>
                      ))
                    }
                  </div>
                )}

                {/* ── Board tab ── */}
                {rightTab === 'board' && (
                  <div className="p-3">
                    {/* Matrix header */}
                    <div className="flex items-center pb-1.5 mb-1 border-b border-gray-100">
                      <span className="flex-1 text-[9px] font-bold text-gray-400 uppercase tracking-wider">Team</span>
                      <span className="w-7 text-center text-[9px] font-bold text-gray-400">F</span>
                      <span className="w-7 text-center text-[9px] font-bold text-gray-400">D</span>
                      <span className="w-7 text-center text-[9px] font-bold text-gray-400">G</span>
                    </div>
                    {boardData.map(m => {
                      const isMe = m.leagueMemberId === myLeagueMemberId
                      const expanded = expandedBoardMember === m.leagueMemberId
                      const color = m.colorPrimary ?? '#FF6B00'
                      return (
                        <div key={m.leagueMemberId}>
                          <button
                            onClick={() => setExpandedBoardMember(expanded ? null : m.leagueMemberId)}
                            className="w-full flex items-center py-1.5 border-b border-gray-50 hover:bg-gray-50 transition text-left"
                          >
                            <div className="flex-1 flex items-center gap-1.5 min-w-0">
                              <TeamIcon icon={m.teamIcon} />
                              <span className={`text-xs truncate ${isMe ? 'font-bold' : 'font-medium'}`}
                                style={isMe ? { color } : { color: '#121212' }}>
                                {m.teamName}
                              </span>
                            </div>
                            <span className="w-7 text-center text-xs font-black" style={m.counts.F ? { color } : { color: '#d1d5db' }}>{m.counts.F}</span>
                            <span className="w-7 text-center text-xs font-black" style={m.counts.D ? { color } : { color: '#d1d5db' }}>{m.counts.D}</span>
                            <span className="w-7 text-center text-xs font-black" style={m.counts.G ? { color } : { color: '#d1d5db' }}>{m.counts.G}</span>
                          </button>
                          {expanded && m.mPicks.length > 0 && (
                            <div className="pl-4 pb-1 bg-gray-50 border-b border-gray-100">
                              {m.mPicks.map(p => (
                                <div key={p.pickNumber} className="flex items-center gap-1.5 py-1">
                                  <span className="text-[9px] text-gray-400 w-4 flex-shrink-0">#{p.pickNumber}</span>
                                  <PositionBadge position={toBucket(p.player.position)} />
                                  <span className="text-[10px] font-semibold text-[#121212] truncate">{p.player.name}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* ── All picks tab ── */}
                {rightTab === 'all' && (
                  <div className="p-3">
                    {picks.length === 0
                      ? <p className="text-xs text-gray-400">No picks yet</p>
                      : [...picks].reverse().map(p => (
                        <div key={p.pickNumber} className="flex items-start gap-2 py-1.5 border-b border-gray-50">
                          <span className="text-[10px] text-gray-400 w-8 flex-shrink-0">#{p.pickNumber}</span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1">
                              <p className="text-xs font-semibold truncate">{p.player.name}</p>
                              <PositionBadge position={toBucket(p.player.position)} />
                            </div>
                            <p className="text-[10px] text-gray-400 truncate">{p.teamName}</p>
                            {p.pickSource !== 'manual' && (
                              <span className="text-[9px] text-blue-500 font-bold">AUTO</span>
                            )}
                          </div>
                        </div>
                      ))
                    }
                  </div>
                )}
              </div>
            </div>
          )
        })()}
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
  const rankMode = 'scoring'
  const [rankPos, setRankPos] = useState<'ALL' | 'F/D' | 'F' | 'D' | 'G'>('ALL')
  const [rankTeamId, setRankTeamId] = useState('')
  const [rankSearch, setRankSearch] = useState('')
  const [rankPlayers, setRankPlayers] = useState<RankedPlayer[]>([])
  const [rankLoading, setRankLoading] = useState(false)
  const [preDraftTeams, setPreDraftTeams] = useState<NhlTeam[]>([])
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
    async function loadTeams() {
      const token = await auth.currentUser?.getIdToken()
      if (!token) return
      const res = await fetch('/api/nhl-teams?playoffQualified=true', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setPreDraftTeams(data.teams)
      }
    }
    loadTeams()
  }, [])

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
      const apiRankPos = rankPos === 'F/D' ? 'FD' : rankPos
      const qs = new URLSearchParams({
        mode: rankMode,
        ...(apiRankPos !== 'ALL' ? { position: apiRankPos } : {}),
        ...(rankTeamId ? { teamId: rankTeamId } : {}),
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
  }, [leagueId, preDraftTab, rankMode, rankPos, rankTeamId, rankSearch])

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
            {/* Position + search filters */}
            <div className="flex gap-2 mb-2 flex-wrap items-center">
              {(['ALL', 'F/D', 'F', 'D', 'G'] as const).map(p => (
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
            {preDraftTeams.length > 0 && (
              <select
                value={rankTeamId}
                onChange={e => setRankTeamId(e.target.value)}
                className="mb-3 w-full border border-[#eeeeee] rounded-lg px-3 py-1.5 text-xs text-[#515151] bg-white"
              >
                <option value="">All Teams</option>
                {preDraftTeams.map(t => (
                  <option key={t.id} value={t.id}>{t.abbreviation}</option>
                ))}
              </select>
            )}

            {/* Table */}
            {rankLoading ? (
              <p className="text-sm text-[#98989e] py-4">Loading…</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-[#eeeeee]">
                <table className="text-xs w-full">
                  <thead>
                    <tr className="bg-[#f8f8f8] text-[#98989e]">
                      <th className="sticky left-0 z-20 bg-[#f8f8f8] px-3 py-2 text-left font-bold uppercase tracking-widest text-[10px] min-w-[160px] border-r border-[#eeeeee]">
                        <span>Player</span>
                        <span style={{ marginLeft: 8, padding: '2px 7px', borderRadius: 999, background: '#fff7ed', color: '#f97316', fontWeight: 700, fontSize: 9, letterSpacing: '1px', textTransform: 'uppercase', verticalAlign: 'middle' }}>
                          2025-26 RS
                        </span>
                      </th>
                      <th className="px-3 py-2 text-right font-bold uppercase tracking-widest text-[10px] bg-[#eef3ff] text-[#0042bb] whitespace-nowrap">PROJ ↓</th>
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
                            {player.proj}
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

// ── PostDraft ─────────────────────────────────────────────────────────────────

function PostDraft({ draft, picks, members, myLeagueMemberId, myColor }: PostDraftProps) {
  const [search, setSearch] = useState('')
  const [expandedRounds, setExpandedRounds] = useState<Set<number>>(new Set([1, 2]))

  const sortedPicks = [...picks].sort((a, b) => a.pickNumber - b.pickNumber)
  const totalRounds = sortedPicks.length > 0 ? Math.max(...sortedPicks.map(p => p.round)) : 0
  const firstPick = sortedPicks[0]
  const lastPick = sortedPicks[sortedPicks.length - 1]

  let durationStr = ''
  if (firstPick && lastPick) {
    const ms = new Date(lastPick.pickedAt).getTime() - new Date(firstPick.pickedAt).getTime()
    const mins = Math.floor(ms / 60000)
    const secs = Math.floor((ms % 60000) / 1000)
    durationStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
  }

  const draftDate = draft.scheduledStartAt
    ? new Date(draft.scheduledStartAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : firstPick
      ? new Date(firstPick.pickedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : '—'

  const filteredPicks = search
    ? sortedPicks.filter(p =>
        p.player.name.toLowerCase().includes(search.toLowerCase()) ||
        p.teamName.toLowerCase().includes(search.toLowerCase())
      )
    : sortedPicks

  // Group by round
  const rounds: Record<number, Pick[]> = {}
  for (const p of filteredPicks) {
    if (!rounds[p.round]) rounds[p.round] = []
    rounds[p.round].push(p)
  }
  const roundNumbers = Object.keys(rounds).map(Number).sort((a, b) => a - b)
  const collapsedPickCount = filteredPicks.filter(p => p.round > 2).length
  const lateRounds = roundNumbers.filter(r => r > 2)
  const allLateExpanded = lateRounds.length > 0 && lateRounds.every(r => expandedRounds.has(r))

  function expandAllLate() {
    setExpandedRounds(prev => { const s = new Set(prev); lateRounds.forEach(r => s.add(r)); return s })
  }

  function renderPick(pick: Pick) {
    const isMe = pick.leagueMemberId === myLeagueMemberId
    const isAuto = pick.pickSource !== 'manual'
    let timeTaken = ''
    if (firstPick) {
      const ms = new Date(pick.pickedAt).getTime() - new Date(firstPick.pickedAt).getTime()
      const s = Math.floor(ms / 1000) % 60
      const m = Math.floor(ms / 60000)
      timeTaken = m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `0:${String(s).padStart(2, '0')}`
    }
    return (
      <div key={pick.pickNumber}
        className="flex items-center gap-3 py-3 border-b border-[#f5f5f5]"
        style={isMe ? { borderLeft: `3px solid ${myColor}`, backgroundColor: myColor + '10', paddingLeft: '10px' } : {}}
      >
        <span className="text-[10px] text-[#98989e] font-bold w-6 flex-shrink-0">#{pick.pickNumber}</span>
        <TeamIcon icon={pick.teamIcon} size="md" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold text-[#121212] truncate">{pick.player.name}</span>
            <PositionBadge position={pick.player.position === 'G' ? 'G' : pick.player.position === 'D' ? 'D' : 'F'} />
          </div>
          <span className="text-[10px] text-[#98989e]">{pick.teamName} · {pick.player.teamId}</span>
        </div>
        <div className="flex-shrink-0">
          {isMe && (
            <span className="text-[9px] font-black px-2 py-0.5 rounded"
              style={{ backgroundColor: myColor + '20', color: myColor }}>YOU</span>
          )}
          {!isMe && isAuto && (
            <span className="text-[9px] font-black text-[#0042bb] bg-[#eef3ff] px-2 py-0.5 rounded">AUTO</span>
          )}
          {!isMe && !isAuto && timeTaken && (
            <span className="text-[10px] text-[#98989e]">{timeTaken}</span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white min-h-screen">
      <div className="p-4 max-w-xl mx-auto">
        {/* Summary card */}
        <div className="bg-[#1a1a1a] rounded-xl p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[9px] font-black text-white bg-[#2db944] px-2 py-0.5 rounded uppercase tracking-wider">COMPLETE</span>
            <span className="text-[10px] text-[#98989e] font-semibold">{draftDate}</span>
          </div>
          <p className="text-sm font-bold text-white">
            {picks.length} picks · {members.length} teams · {totalRounds} rounds
          </p>
          {durationStr && <p className="text-[10px] text-[#98989e] mt-0.5">Draft took {durationStr}</p>}
        </div>

        {/* Search */}
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search picks…"
          className="w-full border border-[#eeeeee] rounded-lg px-3 py-2 text-sm mb-4"
        />

        {/* Rounds */}
        {roundNumbers.map(round => {
          const roundPicks = rounds[round] ?? []
          const isLate = round > 2
          const isExpanded = expandedRounds.has(round)

          // Show collapse toggle before first late round (when not searching)
          if (isLate && !search && round === lateRounds[0] && !allLateExpanded) {
            return (
              <button key={`expand-${round}`}
                onClick={expandAllLate}
                className="w-full text-xs font-bold text-[#98989e] border border-dashed border-[#eeeeee] rounded-xl py-3 mb-3 hover:border-gray-300 hover:text-[#515151] transition">
                Show Rounds 3 – {totalRounds} ({collapsedPickCount} more picks) ▾
              </button>
            )
          }

          if (isLate && !search && !isExpanded) return null

          return (
            <div key={round} className="mb-3">
              <div className="mb-2">
                <span className="text-[9px] font-black text-white bg-[#1a1a1a] px-3 py-1 rounded-full uppercase tracking-wider">
                  ROUND {round}
                </span>
              </div>
              {roundPicks.map(pick => renderPick(pick))}
            </div>
          )
        })}

        {filteredPicks.length === 0 && (
          <p className="text-sm text-[#98989e] text-center py-6">No picks match your search.</p>
        )}
      </div>
    </div>
  )
}
