'use client'
import { useState, useEffect, use } from 'react'
import { auth } from '@/lib/firebase/client'
import { TeamIcon } from '@/components/team-icon'
import { PositionBadge } from '@/components/position-badge'
import { StatCard } from '@/components/stat-card'

// ---- Types ----

interface MemberInfo {
  id: string; teamName: string; teamIcon: string | null
  totalScore: number; colorPrimary: string | null; userName: string
}

interface RosterPlayer {
  playerId: number; name: string; position: string
  nhlTeamAbbrev: string; headshotUrl: string | null
  isEliminated: boolean; totalFpts: number; yesterdayFpts: number | null
  goals: number; assists: number; pts: number; plusMinus: number; pim: number
  powerPlayGoals: number; powerPlayAssists: number
  shorthandedGoals: number; gameWinningGoals: number
  goalieWins: number; goalieSaves: number; shutouts: number
  goalsAgainst: number; seasonSavePct: number
}

interface StandingEntry {
  memberId: string; rank: number; totalScore: number
  yesterdayFpts: number | null; colorPrimary: string | null
}

interface Recap {
  content: string; recapDate: string; standingChange: number
}

type SortDir = 'asc' | 'desc' | null

// ---- Helpers ----

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return s[(v - 20) % 10] ?? s[v] ?? s[0]
}

function fmtFpts(v: number | null): string {
  if (v === null) return '—'
  return v >= 0 ? `+${v.toFixed(1)}` : v.toFixed(1)
}

function isForward(pos: string) { return ['C', 'LW', 'RW'].includes(pos) }

// ---- Sort helper ----

function sortPlayers(players: RosterPlayer[], col: string, dir: SortDir): RosterPlayer[] {
  if (!dir || !col) return players
  return [...players].sort((a, b) => {
    const av = (a[col as keyof RosterPlayer] as number | null) ?? -Infinity
    const bv = (b[col as keyof RosterPlayer] as number | null) ?? -Infinity
    return dir === 'desc' ? (bv as number) - (av as number) : (av as number) - (bv as number)
  })
}

// ---- Column def ----

type ColDef = { key: string; label: string; skater: boolean; goalie: boolean }
const COLS: ColDef[] = [
  { key: 'totalFpts', label: 'FPTS', skater: true, goalie: true },
  { key: 'yesterdayFpts', label: 'YDAY', skater: true, goalie: true },
  { key: 'goals', label: 'G', skater: true, goalie: false },
  { key: 'assists', label: 'A', skater: true, goalie: false },
  { key: 'pts', label: 'PTS', skater: true, goalie: false },
  { key: 'powerPlayGoals', label: 'PPG', skater: true, goalie: false },
  { key: 'powerPlayAssists', label: 'PPA', skater: true, goalie: false },
  { key: 'shorthandedGoals', label: 'SHG', skater: true, goalie: false },
  { key: 'gameWinningGoals', label: 'GWG', skater: true, goalie: false },
  { key: 'plusMinus', label: '+/-', skater: true, goalie: false },
  { key: 'goalieWins', label: 'W', skater: false, goalie: true },
  { key: 'goalieSaves', label: 'SV', skater: false, goalie: true },
  { key: 'seasonSavePct', label: 'SV%', skater: false, goalie: true },
  { key: 'shutouts', label: 'SO', skater: false, goalie: true },
]

// ---- Page ----

export default function MyTeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const [member, setMember] = useState<MemberInfo | null>(null)
  const [players, setPlayers] = useState<RosterPlayer[]>([])
  const [myStanding, setMyStanding] = useState<StandingEntry | null>(null)
  const [recap, setRecap] = useState<Recap | null>(null)
  const [recapOpen, setRecapOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [sortCol, setSortCol] = useState<string>('totalFpts')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  useEffect(() => {
    async function load() {
      const token = await auth.currentUser?.getIdToken()
      if (!token) return
      const headers = { Authorization: `Bearer ${token}` }

      // Step 1: standings gives myMemberId + my rank + my YDAY total
      const standingsRes = await fetch(`/api/leagues/${id}/standings`, { headers })
      if (!standingsRes.ok) { setLoading(false); return }
      const { standings, myMemberId } = await standingsRes.json()
      const mySt = standings.find((s: StandingEntry & { memberId: string }) => s.memberId === myMemberId)
      if (mySt) setMyStanding(mySt)
      if (!myMemberId) { setLoading(false); return }

      // Step 2: roster + recap in parallel
      const [rosterRes, recapRes] = await Promise.all([
        fetch(`/api/leagues/${id}/members/${myMemberId}/roster`, { headers }),
        fetch(`/api/leagues/${id}/recaps`, { headers }),
      ])
      if (rosterRes.ok) {
        const data = await rosterRes.json()
        setMember(data.member)
        setPlayers(data.players)
      }
      if (recapRes.ok) {
        const data = await recapRes.json()
        setRecap(data.recap ?? null)
      }
      setLoading(false)
    }
    load()
  }, [id])

  function cycleSort(col: string) {
    if (sortCol !== col) { setSortCol(col); setSortDir('desc'); return }
    setSortDir(d => d === 'desc' ? 'asc' : d === 'asc' ? null : 'desc')
  }

  function sortIcon(col: string) {
    if (sortCol !== col || !sortDir) return '↕'
    return sortDir === 'desc' ? '↓' : '↑'
  }

  if (loading) return <div className="p-6 text-sm text-[#98989e]">Loading…</div>
  if (!member) return <div className="p-6 text-sm text-[#98989e]">Your roster will appear here after the draft.</div>

  const myColor = member.colorPrimary ?? '#FF6B00'
  const rank = myStanding?.rank ?? 0
  const ydTotal = myStanding?.yesterdayFpts ?? null
  const sorted = sortPlayers(players, sortCol, sortDir)

  return (
    <div className="p-4 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <TeamIcon icon={member.teamIcon} size="lg" />
          <div>
            <div className="text-lg font-black tracking-tight text-[#121212]">{member.teamName}</div>
            <div className="text-xs text-[#98989e] font-semibold">{member.userName}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-black" style={{ color: myColor }}>{member.totalScore.toFixed(1)}</div>
          <div className="text-[9px] text-[#98989e] font-bold uppercase tracking-widest">Total FPTS</div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-1.5 mb-4">
        <StatCard value={rank ? `${rank}${ordinal(rank)}` : '—'} label="Standing" />
        <StatCard
          value={ydTotal !== null ? fmtFpts(ydTotal) : '—'}
          label="Yesterday"
          tone={ydTotal !== null && ydTotal > 0 ? 'positive' : 'default'}
        />
        <StatCard
          value="📰"
          label="Recap"
          tone="dark"
          onClick={recap ? () => setRecapOpen(true) : undefined}
        />
      </div>

      {/* Roster table */}
      {players.length === 0 ? (
        <div className="border border-[#eeeeee] rounded-xl p-6 text-center">
          <p className="text-xs text-[#98989e] font-semibold">Your roster will appear here after the draft.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#eeeeee]">
          <table className="w-full text-xs border-collapse min-w-[700px]">
            <thead>
              <tr className="bg-[#f8f8f8]">
                <th className="sticky left-0 z-10 bg-[#f8f8f8] text-left px-3 py-2 font-bold uppercase tracking-widest text-[#98989e] border-r border-[#eeeeee] min-w-[160px]">
                  Player
                </th>
                {COLS.map(col => (
                  <th
                    key={col.key}
                    onClick={() => cycleSort(col.key)}
                    className={`px-2 py-2 font-bold uppercase tracking-widest cursor-pointer select-none whitespace-nowrap ${
                      col.key === 'totalFpts' ? 'text-[#0042bb]' : 'text-[#98989e]'
                    } hover:text-[#121212]`}
                  >
                    {col.label} {sortIcon(col.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((p, i) => {
                const isG = p.position === 'G'
                const rowBg = i % 2 === 0 ? '#ffffff' : '#fafafa'
                return (
                  <tr key={p.playerId} style={{ backgroundColor: rowBg }}>
                    <td
                      className="sticky left-0 z-10 border-r border-[#eeeeee] px-3 py-2"
                      style={{ backgroundColor: rowBg }}
                    >
                      <div className="flex items-center gap-1.5">
                        <PositionBadge position={isG ? 'G' : isForward(p.position) ? 'F' : 'D'} />
                        <span className={`font-semibold ${p.isEliminated ? 'line-through text-[#98989e]' : 'text-[#121212]'}`}>
                          {p.name}
                        </span>
                        <span className="text-[#98989e] ml-1">{p.nhlTeamAbbrev}</span>
                      </div>
                    </td>
                    {COLS.map(col => {
                      const hidden = (isG && col.skater && !col.goalie) || (!isG && !col.skater && col.goalie)
                      if (hidden) return <td key={col.key} className="px-2 py-2 text-center text-[#98989e]">—</td>

                      const val = p[col.key as keyof RosterPlayer]
                      const isFpts = col.key === 'totalFpts'
                      const isYday = col.key === 'yesterdayFpts'
                      const isPlusMinus = col.key === 'plusMinus'

                      let display: string
                      if (val === null || val === undefined) {
                        display = '—'
                      } else if (col.key === 'seasonSavePct') {
                        display = Number(val) > 0 ? Number(val).toFixed(3) : '—'
                      } else if (isYday) {
                        display = fmtFpts(val as number)
                      } else if (isPlusMinus) {
                        display = Number(val) >= 0 ? `+${val}` : String(val)
                      } else {
                        display = String(val)
                      }

                      return (
                        <td
                          key={col.key}
                          className={`px-2 py-2 text-center font-semibold ${
                            isFpts ? 'bg-[#eef3ff] text-[#0042bb] font-black' :
                            isYday && val !== null && (val as number) > 0 ? 'text-[#2db944]' :
                            isPlusMinus && Number(val) > 0 ? 'text-[#2db944]' :
                            isPlusMinus && Number(val) < 0 ? 'text-[#c8102e]' :
                            'text-[#121212]'
                          }`}
                        >
                          {display}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Recap modal */}
      {recapOpen && recap && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-end"
          onClick={() => setRecapOpen(false)}
        >
          <div
            className="bg-white w-full max-h-[80vh] rounded-t-2xl overflow-y-auto p-5"
            onClick={e => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-[#eeeeee] rounded mx-auto mb-4" />
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-sm font-black text-[#121212]">Morning Recap</p>
                <p className="text-xs text-[#98989e]">{new Date(recap.recapDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
              </div>
              {recap.standingChange !== 0 && (
                <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                  recap.standingChange > 0 ? 'bg-green-100 text-[#2db944]' : 'bg-red-50 text-[#c8102e]'
                }`}>
                  {recap.standingChange > 0 ? '▲' : '▼'} {Math.abs(recap.standingChange)}
                </span>
              )}
            </div>
            <p className="text-sm text-[#121212] leading-relaxed whitespace-pre-wrap">{recap.content}</p>
            <button
              onClick={() => setRecapOpen(false)}
              className="mt-5 w-full py-3 bg-[#1a1a1a] text-white rounded-xl font-bold text-sm"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
