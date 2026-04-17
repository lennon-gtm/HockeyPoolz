'use client'
import { useState, useEffect, useMemo, useCallback } from 'react'
import { auth } from '@/lib/firebase/client'
import { PositionBadge } from './position-badge'
import { InjuryBadge, type InjuryStatus } from './injury-badge'

interface RankedPlayer {
  id: number
  name: string
  position: string
  team: { id: string; name: string; colorPrimary: string } | null
  headshotUrl: string | null
  adp: number | null
  injuryStatus?: InjuryStatus | null
  totals: {
    goals: number; assists: number; plusMinus: number; pim: number; shots: number
    goalieWins: number; goalieSaves: number; goalsAgainst: number; shutouts: number
  }
  proj: number
}

interface NhlTeam { id: string; abbreviation: string; colorPrimary: string }

interface Props {
  leagueId: string
  myColor: string
  /** Player ids to hide from the list (e.g. players already drafted in the live draft). */
  excludeIds?: Set<number> | number[]
  /** When true, show a "Draft" button on each row. Usually only set while the viewer is on the clock. */
  canDraft?: boolean
  /** Called when the user clicks "Draft" on a player row. */
  onDraft?: (playerId: number) => void
  /** Show the ★ wishlist toggle on each row and manage wishlist state internally. */
  enableWishlist?: boolean
  /** Called with the latest wishlist size/ids whenever wishlist changes. */
  onWishlistChange?: (count: number, ids: Set<number>) => void
  /** Increment to force a rankings refetch (e.g. after the league scoring settings change). */
  reloadKey?: number
}

export function PlayerRankingsPanel({
  leagueId, myColor,
  excludeIds,
  canDraft, onDraft,
  enableWishlist = false, onWishlistChange,
  reloadKey,
}: Props) {
  const [pos, setPos] = useState<'ALL' | 'F/D' | 'F' | 'D' | 'G'>('ALL')
  const [teamId, setTeamId] = useState('')
  const [search, setSearch] = useState('')
  const [players, setPlayers] = useState<RankedPlayer[]>([])
  const [teams, setTeams] = useState<NhlTeam[]>([])
  const [wishlistIds, setWishlistIds] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(false)

  // Load playoff teams once for the team filter.
  useEffect(() => {
    async function loadTeams() {
      const token = await auth.currentUser?.getIdToken()
      if (!token) return
      const res = await fetch('/api/nhl-teams?playoffQualified=true', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) setTeams((await res.json()).teams)
    }
    loadTeams()
  }, [])

  // Refresh wishlist state + emit to parent.
  const reloadWishlist = useCallback(async () => {
    if (!enableWishlist) return
    const token = await auth.currentUser?.getIdToken()
    if (!token) return
    const res = await fetch(`/api/leagues/${leagueId}/draft/wishlist`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return
    const data = await res.json()
    const ids = new Set<number>((data.wishlist ?? []).map((w: { playerId: number }) => w.playerId))
    setWishlistIds(ids)
    onWishlistChange?.(ids.size, ids)
  }, [enableWishlist, leagueId, onWishlistChange])

  useEffect(() => { reloadWishlist() }, [reloadWishlist])

  // Fetch rankings when filters change.
  useEffect(() => {
    let cancelled = false
    async function fetchRankings() {
      setLoading(true)
      const token = await auth.currentUser?.getIdToken()
      if (!token) { setLoading(false); return }
      const apiPos = pos === 'F/D' ? 'FD' : pos
      const qs = new URLSearchParams({
        mode: 'scoring',
        ...(apiPos !== 'ALL' ? { position: apiPos } : {}),
        ...(teamId ? { teamId } : {}),
        ...(search ? { search } : {}),
      })
      const res = await fetch(`/api/leagues/${leagueId}/draft/rankings?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok && !cancelled) {
        const data = await res.json()
        setPlayers(data.players ?? [])
      }
      if (!cancelled) setLoading(false)
    }
    fetchRankings()
    return () => { cancelled = true }
  }, [leagueId, pos, teamId, search, reloadKey])

  async function toggleWishlist(playerId: number) {
    if (!enableWishlist) return
    const token = await auth.currentUser?.getIdToken()
    if (!token) return
    if (wishlistIds.has(playerId)) {
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
    } else {
      await fetch(`/api/leagues/${leagueId}/draft/wishlist`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId }),
      })
    }
    reloadWishlist()
  }

  const excludeSet = useMemo(() => {
    if (!excludeIds) return null
    return excludeIds instanceof Set ? excludeIds : new Set(excludeIds)
  }, [excludeIds])
  const displayed = excludeSet ? players.filter(p => !excludeSet.has(p.id)) : players

  const colCount = 8 + (enableWishlist ? 1 : 0) + (onDraft ? 1 : 0)

  return (
    <div>
      {/* Filters */}
      <div className="flex gap-2 mb-2 flex-wrap items-center">
        {(['ALL', 'F/D', 'F', 'D', 'G'] as const).map(p => (
          <button
            key={p}
            onClick={() => setPos(p)}
            className={`px-2.5 py-1 text-xs font-bold rounded transition ${
              pos === p ? 'text-white' : 'bg-[#f8f8f8] text-[#515151] hover:bg-gray-200'
            }`}
            style={pos === p ? { backgroundColor: myColor } : {}}
          >
            {p}
          </button>
        ))}
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search…"
          className="ml-auto border border-[#eeeeee] rounded-lg px-3 py-1 text-xs w-28"
        />
      </div>
      {teams.length > 0 && (
        <select
          value={teamId}
          onChange={e => setTeamId(e.target.value)}
          className="mb-3 w-full border border-[#eeeeee] rounded-lg px-3 py-1.5 text-xs text-[#515151] bg-white"
        >
          <option value="">All Teams</option>
          {teams.map(t => (
            <option key={t.id} value={t.id}>{t.abbreviation}</option>
          ))}
        </select>
      )}

      {loading ? (
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
                <th className="px-3 py-2 text-right font-bold uppercase tracking-widest text-[10px]">ADP</th>
                {enableWishlist && (
                  <th className="px-2 py-2 text-center font-bold uppercase tracking-widest text-[10px]">★</th>
                )}
                {onDraft && (
                  <th className="px-2 py-2 text-center font-bold uppercase tracking-widest text-[10px]">Draft</th>
                )}
              </tr>
            </thead>
            <tbody>
              {displayed.map((player, i) => {
                const isGoalie = player.position === 'G'
                const inWishlist = wishlistIds.has(player.id)
                const rowBg = i % 2 === 1 ? '#fafafa' : '#ffffff'
                return (
                  <tr key={player.id} className="border-t border-[#eeeeee]" style={{ backgroundColor: rowBg }}>
                    <td className="sticky left-0 z-10 px-3 py-2 border-r border-[#eeeeee]" style={{ backgroundColor: rowBg }}>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-[#98989e] w-5 text-right flex-shrink-0">{i + 1}</span>
                        <div className="w-7 h-7 rounded-full bg-gray-100 flex-shrink-0 overflow-hidden">
                          {player.headshotUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={player.headshotUrl} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-[9px] text-gray-400">{player.position}</div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1">
                            <span className="font-bold text-[#121212] truncate text-xs">{player.name}</span>
                            <PositionBadge position={isGoalie ? 'G' : player.position === 'D' ? 'D' : 'F'} />
                            <InjuryBadge status={player.injuryStatus} size="xs" />
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
                    <td
                      className="px-3 py-2 text-right font-semibold"
                      style={{ color: isGoalie ? '#98989e' : player.totals.plusMinus >= 0 ? '#2db944' : '#c8102e' }}
                    >
                      {isGoalie ? '—' : (player.totals.plusMinus > 0 ? `+${player.totals.plusMinus}` : player.totals.plusMinus || '—')}
                    </td>
                    <td className="px-3 py-2 text-right text-[#121212] font-semibold">
                      {isGoalie ? (player.totals.goalieSaves || '—') : (player.totals.shots || '—')}
                    </td>
                    <td className="px-3 py-2 text-right text-[#98989e] font-semibold">
                      {player.adp != null ? Number(player.adp).toFixed(1) : '—'}
                    </td>
                    {enableWishlist && (
                      <td className="px-2 py-2 text-center">
                        <button
                          onClick={() => toggleWishlist(player.id)}
                          className="text-base leading-none hover:scale-110 transition-transform"
                          style={{ color: inWishlist ? '#ffcf00' : '#d1d5db' }}
                        >
                          ★
                        </button>
                      </td>
                    )}
                    {onDraft && (
                      <td className="px-2 py-2 text-center">
                        {canDraft ? (
                          <button
                            onClick={() => onDraft(player.id)}
                            className="text-[10px] text-white px-2 py-1 rounded font-bold whitespace-nowrap"
                            style={{ backgroundColor: myColor }}
                          >
                            Draft
                          </button>
                        ) : null}
                      </td>
                    )}
                  </tr>
                )
              })}
              {displayed.length === 0 && (
                <tr>
                  <td colSpan={colCount} className="px-4 py-6 text-center text-sm text-[#98989e]">
                    No players found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
