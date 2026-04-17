'use client'
import { useState, useEffect, use } from 'react'
import { auth } from '@/lib/firebase/client'
import { TeamIcon } from '@/components/team-icon'
import { PositionBadge } from '@/components/position-badge'
import { InjuryBadge, type InjuryStatus } from '@/components/injury-badge'
import { StatCard } from '@/components/stat-card'

// ---- Types ----

interface MemberInfo {
  id: string; teamName: string; teamIcon: string | null
  totalScore: number; colorPrimary: string | null; userName: string
  whatsappPhone?: string | null; whatsappOptedIn?: boolean
}

interface RosterPlayer {
  playerId: number; name: string; position: string
  nhlTeamAbbrev: string; headshotUrl: string | null
  injuryStatus: InjuryStatus | null
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
  const [loading, setLoading] = useState(true)
  const [sortCol, setSortCol] = useState<string>('totalFpts')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [whatsappPhone, setWhatsappPhone] = useState('')
  const [whatsappOptedIn, setWhatsappOptedIn] = useState(false)
  const [whatsappSaving, setWhatsappSaving] = useState(false)
  const [whatsappError, setWhatsappError] = useState('')
  const [whatsappSaved, setWhatsappSaved] = useState(false)

  useEffect(() => {
    async function load() {
      const token = await auth.currentUser?.getIdToken()
      if (!token) { setLoading(false); return }
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
        setWhatsappPhone(data.member.whatsappPhone ?? '')
        setWhatsappOptedIn(data.member.whatsappOptedIn ?? false)
      }
      if (recapRes.ok) {
        const data = await recapRes.json()
        setRecap(data.recap ?? null)
      }
      setLoading(false)
    }
    load()
  }, [id])

  async function saveWhatsApp() {
    setWhatsappSaving(true)
    setWhatsappError('')
    setWhatsappSaved(false)
    try {
      const token = await auth.currentUser?.getIdToken()
      if (!token) return
      const res = await fetch(`/api/leagues/${id}/members/me`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ whatsappPhone: whatsappPhone.trim(), whatsappOptedIn: true }),
      })
      const data = await res.json()
      if (!res.ok) { setWhatsappError(data.error ?? 'Failed to save'); return }
      setWhatsappOptedIn(true)
      setWhatsappPhone(data.member.whatsappPhone ?? '')
      setWhatsappSaved(true)
    } finally {
      setWhatsappSaving(false)
    }
  }

  async function removeWhatsApp() {
    setWhatsappSaving(true)
    setWhatsappError('')
    try {
      const token = await auth.currentUser?.getIdToken()
      if (!token) return
      await fetch(`/api/leagues/${id}/members/me`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ whatsappPhone: null }),
      })
      setWhatsappPhone('')
      setWhatsappOptedIn(false)
      setWhatsappSaved(false)
    } finally {
      setWhatsappSaving(false)
    }
  }

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

      {/* Personal recap card */}
      {recap && (
        <div className="bg-[#f8f8f8] rounded-xl p-4 mb-4 border border-[#eeeeee]">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-black tracking-[2px] uppercase text-[#98989e]">Morning Recap</span>
              <span className="text-[9px] text-[#98989e]">
                {new Date(recap.recapDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            </div>
            {recap.standingChange !== 0 && (
              <span className={`text-[9px] font-bold px-2 py-0.5 rounded ${
                recap.standingChange > 0 ? 'bg-green-100 text-[#2db944]' : 'bg-red-50 text-[#c8102e]'
              }`}>
                {recap.standingChange > 0 ? '▲' : '▼'} {Math.abs(recap.standingChange)}
              </span>
            )}
          </div>
          <p className="text-sm text-[#121212] leading-relaxed">{recap.content}</p>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-1.5 mb-4">
        <StatCard value={rank ? `${rank}${ordinal(rank)}` : '—'} label="Standing" />
        <StatCard
          value={ydTotal !== null ? fmtFpts(ydTotal) : '—'}
          label="Yesterday"
          tone={ydTotal !== null && ydTotal > 0 ? 'positive' : 'default'}
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
                        <InjuryBadge status={p.injuryStatus} size="xs" />
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

      {/* WhatsApp opt-in */}
      <div className="mt-4 border border-[#eeeeee] rounded-xl p-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-black text-[#121212]">📲 Daily Recap on WhatsApp</span>
        </div>
        <p className="text-[11px] text-[#98989e] mb-3">Get your morning recap sent directly to WhatsApp. One message per day, per league.</p>

        {whatsappOptedIn && whatsappPhone ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-[#121212]">
                {(() => {
                  const p = whatsappPhone
                  if (p.length <= 7) return p
                  return p.slice(0, 3) + ' ••• ' + p.slice(-4)
                })()}
              </span>
              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-[#2db944]">✓ Active</span>
            </div>
            <button
              onClick={removeWhatsApp}
              disabled={whatsappSaving}
              className="text-xs font-bold text-[#c8102e] hover:underline disabled:opacity-50"
            >
              Remove
            </button>
          </div>
        ) : (
          <div>
            <input
              type="tel"
              value={whatsappPhone}
              onChange={e => { setWhatsappPhone(e.target.value); setWhatsappError(''); setWhatsappSaved(false) }}
              placeholder="+1 416 555 1234"
              className="w-full border-2 border-[#eeeeee] rounded-xl px-3 py-2.5 text-sm mb-1 focus:border-[#f97316] outline-none"
            />
            {whatsappError && <p className="text-xs text-[#c8102e] mb-2">{whatsappError}</p>}
            {whatsappSaved && <p className="text-xs text-[#2db944] mb-2">✓ Saved! You&apos;ll receive your next recap on WhatsApp.</p>}
            <p className="text-[10px] text-[#98989e] mb-3">
              By saving your number you agree to receive one daily recap message per league.
            </p>
            <button
              onClick={saveWhatsApp}
              disabled={whatsappSaving || !whatsappPhone.trim()}
              className="w-full py-2.5 rounded-xl font-bold text-white text-sm disabled:opacity-40 transition"
              style={{ backgroundColor: myColor }}
            >
              {whatsappSaving ? 'Saving…' : 'Save & Enable'}
            </button>
          </div>
        )}
      </div>

    </div>
  )
}
