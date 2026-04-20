'use client'
import { useState, useEffect, useCallback, useRef, use } from 'react'
import { auth } from '@/lib/firebase/client'
import { useRouter } from 'next/navigation'
import { TeamIcon } from '@/components/team-icon'
import { PositionBadge } from '@/components/position-badge'
import { InjuryBadge, type InjuryStatus } from '@/components/injury-badge'
import { PlayerRankingsPanel } from '@/components/player-rankings-panel'

function toBucket(pos: string): 'F' | 'D' | 'G' {
  if (pos === 'G') return 'G'
  if (pos === 'D') return 'D'
  return 'F'
}

/**
 * Snake-draft picker index (0-indexed) for a given pick. Mirrors the pure
 * helper in lib/draft-engine.ts — kept inline here so the client bundle
 * doesn't pull Prisma in.
 */
function pickerIndexFor(pickNumber: number, memberCount: number): number {
  const round = Math.ceil(pickNumber / memberCount)
  const posInRound = (pickNumber - 1) % memberCount
  return round % 2 === 1 ? posInRound : memberCount - 1 - posInRound
}

function picksUntilDraftPosition(
  currentPickNumber: number,
  myDraftPosition: number,
  memberCount: number,
  totalPicks: number,
): number | null {
  for (let p = currentPickNumber; p <= totalPicks; p++) {
    if (pickerIndexFor(p, memberCount) + 1 === myDraftPosition) {
      return p - currentPickNumber
    }
  }
  return null
}

interface Pick {
  pickNumber: number; round: number
  leagueMemberId: string; teamName: string; teamIcon: string | null
  player: { id: number; name: string; position: string; teamId: string; headshotUrl: string | null; injuryStatus?: InjuryStatus | null }
  pickSource: string; pickedAt: string
}
interface MemberSummary {
  leagueMemberId: string; teamName: string; teamIcon: string | null
  userName?: string
  draftPosition: number; pickCount: number; autodraftEnabled: boolean; isCommissioner: boolean
  colorPrimary: string | null
  draftLobbyReady?: boolean
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

export default function DraftRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = use(params)
  const router = useRouter()
  const [state, setState] = useState<DraftState | null>(null)
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const [pickLoading, setPickLoading] = useState(false)
  const [error, setError] = useState('')
  const [rightTab, setRightTab] = useState<'mine' | 'board' | 'all'>('mine')
  const [expandedBoardMember, setExpandedBoardMember] = useState<string | null>(null)
  const [preDraftTab, setPreDraftTab] = useState<'rankings' | 'wishlist'>('rankings')
  const [autodraftEnabled, setAutodraftEnabled] = useState(false)
  const [liveAutodraft, setLiveAutodraft] = useState(false)
  const [autodraftSaving, setAutodraftSaving] = useState(false)
  const [restartOpen, setRestartOpen] = useState(false)
  const [restartSaving, setRestartSaving] = useState(false)
  const [editingPick, setEditingPick] = useState<Pick | null>(null)
  const [rewindingPick, setRewindingPick] = useState<Pick | null>(null)
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>('default')
  const prevIsMyTurnRef = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setNotifPermission('unsupported')
      return
    }
    setNotifPermission(Notification.permission)
  }, [])

  async function requestNotifPermission() {
    if (typeof window === 'undefined' || !('Notification' in window)) return
    const result = await Notification.requestPermission()
    setNotifPermission(result)
  }

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

  // Poll draft state every 5 seconds
  useEffect(() => {
    fetchState()
    const interval = setInterval(fetchState, 5000)
    return () => clearInterval(interval)
  }, [fetchState])

  // Fire a browser notification the first tick my turn starts.
  useEffect(() => {
    const isMyTurn = !!state?.currentPicker?.isMe && state?.draft?.status === 'active'
    if (!isMyTurn) {
      prevIsMyTurnRef.current = false
      return
    }
    if (prevIsMyTurnRef.current) return
    prevIsMyTurnRef.current = true
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification("🏒 You're on the clock!", {
          body: `Pick ${state!.draft!.currentPickNumber} · ${state!.draft!.pickTimeLimitSecs}s to draft`,
          tag: 'hockeypoolz-on-clock',
        })
      } catch { /* some browsers throw if page is hidden — ignore */ }
    }
  }, [state?.currentPicker?.isMe, state?.draft?.status, state?.draft?.currentPickNumber, state])

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

  async function restartDraft(randomize: boolean) {
    setRestartSaving(true)
    setError('')
    try {
      const token = await getToken()
      const res = await fetch(`/api/leagues/${leagueId}/draft/restart`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ randomize }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Restart failed')
        return
      }
      setRestartOpen(false)
      await fetchState()
    } finally {
      setRestartSaving(false)
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

  const commissionerModals = (
    <>
      {restartOpen && (
        <RestartDraftModal
          onCancel={() => { if (!restartSaving) setRestartOpen(false) }}
          onConfirm={restartDraft}
          saving={restartSaving}
        />
      )}
      {editingPick && (
        <EditPickModal
          leagueId={leagueId}
          pick={editingPick}
          onClose={() => setEditingPick(null)}
          onSaved={async () => { setEditingPick(null); await fetchState() }}
        />
      )}
      {rewindingPick && (
        <RewindPickModal
          leagueId={leagueId}
          pick={rewindingPick}
          laterPickCount={state.picks.filter(p => p.pickNumber > rewindingPick.pickNumber).length}
          onClose={() => setRewindingPick(null)}
          onDone={async () => { setRewindingPick(null); await fetchState() }}
        />
      )}
    </>
  )

  if (!state.draft || state.draft.status === 'pending') {
    return (
      <>
        {commissionerModals}
        <PreDraft
          leagueId={leagueId}
          draft={state.draft}
          myColor={state.myColor ?? '#FF6B00'}
          preDraftTab={preDraftTab}
          setPreDraftTab={setPreDraftTab}
          autodraftEnabled={autodraftEnabled}
          setAutodraftEnabled={setAutodraftEnabled}
          isCommissioner={state.isCommissioner}
          onDraftStarted={fetchState}
          members={state.members}
          myLeagueMemberId={state.myLeagueMemberId}
          refetchState={fetchState}
        />
      </>
    )
  }

  if (state.draft.status === 'complete') {
    return (
      <>
        {commissionerModals}
        <PostDraft
          draft={state.draft}
          picks={state.picks}
          members={state.members}
          myLeagueMemberId={state.myLeagueMemberId}
          myColor={state.myColor ?? '#FF6B00'}
          isCommissioner={state.isCommissioner}
          onEditPick={setEditingPick}
          onRewindPick={setRewindingPick}
        />
      </>
    )
  }

  const { draft, currentPicker, picks, members, myLeagueMemberId, isCommissioner } = state
  const isMyTurn = currentPicker?.isMe && draft.status === 'active'
  const myPicks = picks.filter(p => p.leagueMemberId === myLeagueMemberId)
  const timerPct = secondsLeft !== null ? (secondsLeft / draft.pickTimeLimitSecs) * 100 : 100
  const timerColor = secondsLeft !== null && secondsLeft <= 15 ? '#ef4444' : '#f97316'
  const pickerColor = currentPicker?.colorPrimary ?? '#FF6B00'

  const myDraftPosition = members.find(m => m.leagueMemberId === myLeagueMemberId)?.draftPosition ?? null
  const picksUntilMyTurn = myDraftPosition
    ? picksUntilDraftPosition(draft.currentPickNumber, myDraftPosition, members.length, draft.totalPicks)
    : null

  return (
    <div className="bg-white min-h-screen">
      {commissionerModals}
      <div className="p-4 max-w-5xl mx-auto">
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
        {isCommissioner && (
          <div className="flex items-center gap-2">
            {draft.status === 'active' && (
              <button onClick={() => commissionerAction('pause')}
                className="text-xs border border-gray-300 px-3 py-1.5 rounded-lg font-bold hover:bg-gray-100">
                ⏸ Pause
              </button>
            )}
            {draft.status === 'paused' && (
              <button onClick={() => commissionerAction('resume')}
                className="text-xs bg-orange-500 text-white px-3 py-1.5 rounded-lg font-bold hover:bg-orange-600">
                ▶ Resume
              </button>
            )}
            <button onClick={() => setRestartOpen(true)}
              className="text-xs border border-[#c8102e] text-[#c8102e] px-3 py-1.5 rounded-lg font-bold hover:bg-[#c8102e]/10">
              ↻ Restart
            </button>
          </div>
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

      {/* Pick alert banner — 'You're up in N picks' + enable-notifications */}
      {myLeagueMemberId && draft.status !== 'complete' && (() => {
        const myColor = state.myColor ?? '#FF6B00'
        let label: string
        if (isMyTurn) label = "🏒 You're on the clock — pick now!"
        else if (picksUntilMyTurn === null) label = 'All your picks are in — enjoy the rest of the draft.'
        else if (picksUntilMyTurn === 0) label = "🏒 You're up next!"
        else if (picksUntilMyTurn === 1) label = 'On deck — you pick after this one.'
        else label = `You're up in ${picksUntilMyTurn} picks.`
        const showEnableNotifs = notifPermission === 'default'
        return (
          <div
            className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl mb-3"
            style={{
              backgroundColor: isMyTurn ? myColor + '20' : '#f8f8f8',
              border: isMyTurn ? `2px solid ${myColor}` : '1px solid transparent',
            }}
          >
            <p className="text-sm font-bold text-[#121212]">{label}</p>
            {showEnableNotifs && (
              <button
                onClick={requestNotifPermission}
                className="text-[11px] font-bold text-white bg-[#0042bb] rounded-md px-2.5 py-1.5 hover:bg-[#003399] whitespace-nowrap"
                title="Get a browser alert when it's your turn"
              >
                🔔 Alert me
              </button>
            )}
            {notifPermission === 'denied' && (
              <span className="text-[10px] text-[#98989e]">Notifications blocked · enable in site settings</span>
            )}
            {notifPermission === 'granted' && !isMyTurn && (
              <span className="text-[10px] text-[#2db944] font-bold">🔔 Alerts on</span>
            )}
          </div>
        )
      })()}

      {/* Mid-draft autodraft toggle */}
      {state.myLeagueMemberId && (
        <div className="flex items-center justify-between px-3 py-2.5 bg-[#f8f8f8] rounded-xl mb-3">
          <div>
            <p className="text-xs font-bold text-[#121212]">
              {liveAutodraft ? '🤖 Autodraft on' : 'Autodraft off'}
            </p>
            <p className="text-[10px] text-[#98989e]">
              {liveAutodraft ? "We'll pick for you going forward" : "Switch on and we'll pick top 2025-26 points"}
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
        {/* Left panel: available players — shared rankings table (same columns + filters as pre-draft). */}
        <div className="flex-1 overflow-y-auto border-r border-gray-200 bg-white">
          <div className="p-3">
            <PlayerRankingsPanel
              leagueId={leagueId}
              myColor={state.myColor ?? '#FF6B00'}
              excludeIds={picks.map(p => p.player.id)}
              canDraft={!!isMyTurn && !pickLoading}
              onDraft={makePick}
              enableWishlist
            />
          </div>
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
                              <InjuryBadge status={p.player.injuryStatus} size="xs" />
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
                                  <InjuryBadge status={p.player.injuryStatus} size="xs" />
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
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1">
                              <p className="text-xs font-semibold truncate">{p.player.name}</p>
                              <PositionBadge position={toBucket(p.player.position)} />
                              <InjuryBadge status={p.player.injuryStatus} size="xs" />
                            </div>
                            <p className="text-[10px] text-gray-400 truncate">{p.teamName}</p>
                            {p.pickSource !== 'manual' && (
                              <span className="text-[9px] text-blue-500 font-bold">AUTO</span>
                            )}
                          </div>
                          {isCommissioner && (
                            <CommishPickActions
                              onEdit={() => setEditingPick(p)}
                              onRewind={() => setRewindingPick(p)}
                            />
                          )}
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

interface WishlistEntry {
  id: string; playerId: number; rank: number
  player: { id: number; name: string; position: string; adp: number | null
            injuryStatus?: InjuryStatus | null
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
  isCommissioner: boolean
  onDraftStarted: () => void
  members: MemberSummary[]
  myLeagueMemberId: string | null
  refetchState: () => Promise<void> | void
}

interface PostDraftProps {
  draft: NonNullable<DraftState['draft']>
  picks: Pick[]
  members: MemberSummary[]
  myLeagueMemberId: string | null
  myColor: string
  isCommissioner: boolean
  onEditPick: (pick: Pick) => void
  onRewindPick: (pick: Pick) => void
}

// ── PreDraft ──────────────────────────────────────────────────────────────────

function PreDraft({
  leagueId, draft, myColor,
  preDraftTab, setPreDraftTab,
  autodraftEnabled, setAutodraftEnabled,
  isCommissioner, onDraftStarted,
  members, myLeagueMemberId, refetchState,
}: PreDraftProps) {
  const [wishlistCount, setWishlistCount] = useState(0)
  const [countdown, setCountdown] = useState('TBD')
  const [wishlist, setWishlist] = useState<WishlistEntry[]>([])
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [startLoading, setStartLoading] = useState(false)
  const [startError, setStartError] = useState('')
  const [bulletin, setBulletin] = useState<{ content: string; recapDate: string } | null>(null)
  const [bulletinSaving, setBulletinSaving] = useState(false)
  const [readyToggling, setReadyToggling] = useState(false)

  const myMember = members.find(m => m.leagueMemberId === myLeagueMemberId)
  const readyCount = members.filter(m => m.draftLobbyReady).length

  async function toggleReady() {
    if (!myMember) return
    setReadyToggling(true)
    try {
      const token = await auth.currentUser?.getIdToken()
      if (!token) return
      const res = await fetch(`/api/leagues/${leagueId}/members/me`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftLobbyReady: !myMember.draftLobbyReady }),
      })
      if (res.ok) await refetchState()
    } finally {
      setReadyToggling(false)
    }
  }

  async function loadBulletin() {
    const token = await auth.currentUser?.getIdToken()
    if (!token) return
    const res = await fetch(`/api/leagues/${leagueId}/league-recap`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return
    const data = await res.json()
    setBulletin(data.recap ?? null)
  }

  useEffect(() => { loadBulletin() }, [leagueId])  // eslint-disable-line react-hooks/exhaustive-deps

  async function regenerateBulletin() {
    setBulletinSaving(true)
    try {
      const token = await auth.currentUser?.getIdToken()
      if (!token) return
      const res = await fetch(`/api/leagues/${leagueId}/league-recap/regenerate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setBulletin(data.recap ?? null)
      }
    } finally {
      setBulletinSaving(false)
    }
  }

  async function startDraftNow() {
    setStartLoading(true)
    setStartError('')
    try {
      const token = await auth.currentUser?.getIdToken()
      if (!token) return
      // Ensure a draft row exists (safe on re-launch after restart; restart leaves it in place).
      if (!draft) {
        await fetch(`/api/leagues/${leagueId}/draft`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
      }
      const res = await fetch(`/api/leagues/${leagueId}/draft`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setStartError(data.error ?? 'Failed to start draft')
        return
      }
      onDraftStarted()
    } finally {
      setStartLoading(false)
    }
  }

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

  async function removeFromWishlist(playerId: number) {
    const token = await auth.currentUser?.getIdToken()
    if (!token) return
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
    loadWishlist()
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
            <p className="text-[9px] text-[#98989e] mt-0.5">{autodraftEnabled ? "On — we'll pick top 2025-26 points" : 'Off'}</p>
          </div>
        </div>

        {/* Commissioner: launch the draft now */}
        {isCommissioner && (
          <div className="mb-4">
            <button
              onClick={startDraftNow}
              disabled={startLoading}
              style={{ backgroundColor: myColor }}
              className="w-full py-3 text-white rounded-xl text-sm font-bold hover:opacity-90 disabled:opacity-50 transition"
            >
              {startLoading ? 'Starting…' : '🚀 Start Draft Now'}
            </button>
            {startError && (
              <p className="text-xs text-[#c8102e] mt-2 font-semibold">{startError}</p>
            )}
          </div>
        )}

        {/* League bulletin — shown whenever one exists for the league */}
        {bulletin && (
          <div className="bg-[#fff7ed] rounded-xl border border-[#fed7aa] p-4 mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[9px] font-black tracking-[2px] uppercase text-[#f97316]">📣 League Bulletin</span>
              <span className="text-[9px] text-[#fb923c] font-semibold">
                {new Date(bulletin.recapDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            </div>
            <p className="text-sm leading-relaxed text-[#431407]">{bulletin.content}</p>
            {isCommissioner && (
              <button
                onClick={regenerateBulletin}
                disabled={bulletinSaving}
                className="mt-3 text-[10px] font-bold text-[#c2410c] hover:underline disabled:opacity-50"
              >
                {bulletinSaving ? 'Regenerating…' : '↻ Regenerate bulletin'}
              </button>
            )}
          </div>
        )}
        {!bulletin && isCommissioner && (
          <div className="rounded-xl border border-dashed border-[#fed7aa] bg-[#fff7ed]/40 p-3 mb-4 flex items-center justify-between">
            <span className="text-xs text-[#c2410c] font-semibold">No league bulletin yet.</span>
            <button
              onClick={regenerateBulletin}
              disabled={bulletinSaving}
              className="text-[11px] font-bold text-white bg-[#f97316] rounded-md px-2.5 py-1 hover:bg-[#ea580c] disabled:opacity-50"
            >
              {bulletinSaving ? 'Generating…' : '📣 Generate now'}
            </button>
          </div>
        )}

        {/* Draft lobby — ready check-in */}
        {members.length > 0 && (
          <div className="rounded-xl border border-[#eeeeee] bg-white mb-4">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#f5f5f5]">
              <div>
                <p className="text-[9px] font-black tracking-[2px] uppercase text-[#98989e]">Draft Lobby</p>
                <p className="text-sm font-bold text-[#121212] mt-0.5">
                  {readyCount} of {members.length} ready
                </p>
              </div>
              {myMember && (
                <button
                  onClick={toggleReady}
                  disabled={readyToggling}
                  className={`px-4 py-2 rounded-lg text-xs font-bold transition disabled:opacity-50 ${
                    myMember.draftLobbyReady
                      ? 'bg-[#2db944] text-white hover:bg-[#259537]'
                      : 'bg-[#f8f8f8] text-[#121212] border-2 border-[#eeeeee] hover:border-gray-400'
                  }`}
                >
                  {readyToggling
                    ? 'Saving…'
                    : myMember.draftLobbyReady
                      ? '✓ I’m Ready'
                      : "I’m Ready"}
                </button>
              )}
            </div>
            <ul className="divide-y divide-[#f5f5f5]">
              {[...members]
                .sort((a, b) => (a.draftPosition ?? 999) - (b.draftPosition ?? 999))
                .map(m => {
                  const isMe = m.leagueMemberId === myLeagueMemberId
                  return (
                    <li key={m.leagueMemberId} className="flex items-center gap-2 px-4 py-2">
                      <span className="text-[10px] text-[#98989e] w-5 text-right flex-shrink-0">
                        {m.draftPosition ?? '—'}
                      </span>
                      <TeamIcon icon={m.teamIcon} />
                      <div className="min-w-0 flex-1">
                        <p
                          className={`text-xs font-bold truncate ${isMe ? '' : 'text-[#121212]'}`}
                          style={isMe ? { color: m.colorPrimary ?? myColor } : undefined}
                        >
                          {m.teamName}{isMe && ' (you)'}
                        </p>
                        {m.userName && <p className="text-[10px] text-[#98989e] truncate">{m.userName}</p>}
                      </div>
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
                  )
                })}
            </ul>
          </div>
        )}

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

        {/* Tab content — Rankings (shared with live draft) and Wishlist */}
        {preDraftTab === 'rankings' && (
          <PlayerRankingsPanel
            leagueId={leagueId}
            myColor={myColor}
            enableWishlist
            onWishlistChange={count => setWishlistCount(count)}
          />
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
                          <InjuryBadge status={entry.player.injuryStatus} size="xs" />
                        </div>
                        <span className="text-[10px] text-[#98989e]">{entry.player.team?.id ?? '—'}</span>
                      </div>
                      <div className="flex gap-4 items-center flex-shrink-0">
                        {entry.player.proj !== undefined && (
                          <div className="text-right">
                            <div className="text-[10px] font-black bg-[#eef3ff] text-[#0042bb] px-2 py-0.5 rounded">{entry.player.proj.toFixed(2)}</div>
                            <div className="text-[9px] text-[#98989e] font-semibold text-center">PROJ</div>
                          </div>
                        )}
                        <div className="text-right">
                          <div className="text-xs font-bold text-[#121212]">{entry.player.adp?.toFixed(1) ?? '—'}</div>
                          <div className="text-[9px] text-[#98989e] font-semibold">ADP</div>
                        </div>
                        <button onClick={() => removeFromWishlist(entry.playerId)}
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

function PostDraft({ draft, picks, members, myLeagueMemberId, myColor, isCommissioner, onEditPick, onRewindPick }: PostDraftProps) {
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
            <InjuryBadge status={pick.player.injuryStatus} size="xs" />
          </div>
          <span className="text-[10px] text-[#98989e]">{pick.teamName} · {pick.player.teamId}</span>
        </div>
        <div className="flex-shrink-0 flex items-center gap-2">
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
          {isCommissioner && (
            <CommishPickActions
              onEdit={() => onEditPick(pick)}
              onRewind={() => onRewindPick(pick)}
            />
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

// ── Commissioner pick controls ────────────────────────────────────────────────

interface RestartModalProps {
  onCancel: () => void
  onConfirm: (randomize: boolean) => void
  saving: boolean
}

// ── Per-pick commissioner menu (inline on pick rows) ─────────────────────────

function CommishPickActions({ onEdit, onRewind }: { onEdit: () => void; onRewind: () => void }) {
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={e => { e.stopPropagation(); onEdit() }}
        title="Edit pick"
        className="text-[11px] w-6 h-6 rounded-md border border-[#eeeeee] text-[#515151] hover:border-[#0042bb] hover:text-[#0042bb] transition"
      >
        ✎
      </button>
      <button
        onClick={e => { e.stopPropagation(); onRewind() }}
        title="Rewind draft to this pick"
        className="text-[11px] w-6 h-6 rounded-md border border-[#eeeeee] text-[#515151] hover:border-[#c8102e] hover:text-[#c8102e] transition"
      >
        ↶
      </button>
    </div>
  )
}

// ── EditPickModal ─────────────────────────────────────────────────────────────

interface EditPickModalProps {
  leagueId: string
  pick: Pick
  onClose: () => void
  onSaved: () => void
}

interface PlayerSearchResult {
  id: number
  name: string
  teamId: string
  position: string
}

function EditPickModal({ leagueId, pick, onClose, onSaved }: EditPickModalProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PlayerSearchResult[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return }
    const handle = setTimeout(async () => {
      const token = await auth.currentUser?.getIdToken()
      if (!token) return
      const res = await fetch(`/api/players?q=${encodeURIComponent(query.trim())}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setResults(data.players ?? [])
      }
    }, 200)
    return () => clearTimeout(handle)
  }, [query])

  async function choose(playerId: number) {
    setSaving(true)
    setError('')
    try {
      const token = await auth.currentUser?.getIdToken()
      const res = await fetch(`/api/leagues/${leagueId}/draft/picks/${pick.pickNumber}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Edit failed')
        return
      }
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl max-w-md w-full p-5 shadow-xl max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-base font-black text-[#121212] mb-1">
          Edit pick #{pick.pickNumber}
        </h2>
        <p className="text-xs text-[#515151] mb-3">
          {pick.teamName} — currently <span className="font-bold">{pick.player.name}</span>.
          Pick a replacement.
        </p>
        <input
          autoFocus
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search player…"
          className="w-full border border-[#eeeeee] rounded-lg px-3 py-2 text-sm mb-3"
        />
        <div className="flex-1 overflow-y-auto -mx-5 px-5">
          {results.length === 0 && query.trim().length >= 2 && (
            <p className="text-xs text-[#98989e]">No matches.</p>
          )}
          {results.map(r => (
            <button
              key={r.id}
              onClick={() => choose(r.id)}
              disabled={saving}
              className="w-full flex items-center gap-2 text-left py-2 border-b border-[#f5f5f5] hover:bg-[#f8f8f8] transition disabled:opacity-50"
            >
              <span className="text-sm font-semibold truncate">{r.name}</span>
              <PositionBadge position={r.position === 'G' ? 'G' : r.position === 'D' ? 'D' : 'F'} />
              <span className="text-[10px] text-[#98989e]">{r.teamId}</span>
            </button>
          ))}
        </div>
        {error && <p className="text-xs text-[#c8102e] font-semibold mt-3">{error}</p>}
        <button
          onClick={onClose}
          disabled={saving}
          className="w-full mt-3 py-2 text-xs text-[#98989e] font-semibold hover:text-[#515151] disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── RewindPickModal ───────────────────────────────────────────────────────────

interface RewindPickModalProps {
  leagueId: string
  pick: Pick
  laterPickCount: number
  onClose: () => void
  onDone: () => void
}

function RewindPickModal({ leagueId, pick, laterPickCount, onClose, onDone }: RewindPickModalProps) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function confirm() {
    setSaving(true)
    setError('')
    try {
      const token = await auth.currentUser?.getIdToken()
      const res = await fetch(`/api/leagues/${leagueId}/draft/picks/${pick.pickNumber}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Rewind failed')
        return
      }
      onDone()
    } finally {
      setSaving(false)
    }
  }

  const willDelete = laterPickCount + 1
  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl max-w-sm w-full p-5 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-base font-black text-[#121212] mb-1">Rewind to pick #{pick.pickNumber}?</h2>
        <p className="text-xs text-[#515151] mb-4">
          Deletes pick #{pick.pickNumber} ({pick.player.name}) and {laterPickCount}{' '}
          pick{laterPickCount === 1 ? '' : 's'} after it ({willDelete} total). The draft
          will be paused so you can review before resuming.
        </p>
        <div className="flex flex-col gap-2">
          <button
            onClick={confirm}
            disabled={saving}
            className="w-full py-2.5 rounded-lg font-bold text-sm bg-[#c8102e] text-white hover:bg-[#a80d27] disabled:opacity-50"
          >
            {saving ? 'Working…' : `Delete ${willDelete} pick${willDelete === 1 ? '' : 's'} & rewind`}
          </button>
          <button
            onClick={onClose}
            disabled={saving}
            className="w-full py-2 text-xs text-[#98989e] font-semibold hover:text-[#515151] disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
        {error && <p className="text-xs text-[#c8102e] font-semibold mt-3">{error}</p>}
      </div>
    </div>
  )
}

function RestartDraftModal({ onCancel, onConfirm, saving }: RestartModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-xl max-w-sm w-full p-5 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-base font-black text-[#121212] mb-1">Restart draft?</h2>
        <p className="text-xs text-[#515151] mb-4">
          All picks will be wiped and the draft returns to the pre-draft lobby. This
          can&apos;t be undone.
        </p>
        <div className="flex flex-col gap-2">
          <button
            onClick={() => onConfirm(false)}
            disabled={saving}
            className="w-full py-2.5 rounded-lg font-bold text-sm bg-[#f8f8f8] text-[#121212] hover:bg-gray-200 disabled:opacity-50"
          >
            {saving ? 'Working…' : 'Keep current order'}
          </button>
          <button
            onClick={() => onConfirm(true)}
            disabled={saving}
            className="w-full py-2.5 rounded-lg font-bold text-sm bg-[#c8102e] text-white hover:bg-[#a80d27] disabled:opacity-50"
          >
            {saving ? 'Working…' : 'Randomize draft order'}
          </button>
          <button
            onClick={onCancel}
            disabled={saving}
            className="w-full py-2 text-xs text-[#98989e] font-semibold hover:text-[#515151] disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

