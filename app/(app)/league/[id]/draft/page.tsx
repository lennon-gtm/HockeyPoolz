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
  } | null
  currentPicker: {
    leagueMemberId: string; teamName: string; teamIcon: string | null
    isMe: boolean; autodraftEnabled: boolean; colorPrimary: string | null
  } | null
  picks: Pick[]
  members: MemberSummary[]
  myLeagueMemberId: string | null
  isCommissioner: boolean
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

  async function getToken() { return await auth.currentUser?.getIdToken() ?? '' }

  const fetchState = useCallback(async () => {
    const token = await getToken()
    const res = await fetch(`/api/leagues/${leagueId}/draft/state`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return
    const data: DraftState = await res.json()
    setState(data)
    if (data.draft?.status === 'complete') router.push(`/league/${leagueId}`)
  }, [leagueId, router])

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
  if (!state.draft) return <div className="p-6 text-gray-400 text-sm">Draft not started yet.</div>

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
