'use client'
import { useState, useEffect, use } from 'react'
import { auth } from '@/lib/firebase/client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { TeamIcon } from '@/components/team-icon'

interface PlayerStanding {
  playerId: number; name: string; position: string; teamAbbrev: string
  headshotUrl: string | null; totalPoints: number; isEliminated: boolean
  stats: Record<string, number>
}
interface MemberStanding {
  rank: number; memberId: string; teamName: string; teamIcon: string | null
  userName: string; totalScore: number; scoreLastCalculatedAt: string | null
  colorPrimary: string | null; yesterdayFpts: number | null
  players: PlayerStanding[]
}
interface ScoringSettings {
  [key: string]: number
}

export default function StandingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [standings, setStandings] = useState<MemberStanding[]>([])
  const [scoringSettings, setScoringSettings] = useState<ScoringSettings | null>(null)
  const [expandedMember, setExpandedMember] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [error, setError] = useState('')
  const [myMemberId, setMyMemberId] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const token = await auth.currentUser?.getIdToken()
        if (!token) { setError('Not signed in.'); return }

        const standingsRes = await fetch(`/api/leagues/${id}/standings`, {
          headers: { Authorization: `Bearer ${token}` },
        })

        if (!standingsRes.ok) { setError('Failed to load standings.'); return }
        const data = await standingsRes.json()
        setStandings(data.standings)
        setScoringSettings(data.scoringSettings)
        setMyMemberId(data.myMemberId ?? null)
      } catch {
        setError('Failed to load standings.')
      }
    }
    load()
  }, [id])

  const lastUpdated = standings[0]?.scoreLastCalculatedAt
    ? new Date(standings[0].scoreLastCalculatedAt).toLocaleString()
    : null

  const SETTING_LABELS: Record<string, string> = {
    goals: 'Goals', assists: 'Assists', plusMinus: '+/-', pim: 'PIM',
    shots: 'Shots', hits: 'Hits', blockedShots: 'Blocked Shots',
    powerPlayGoals: 'PP Goals', powerPlayAssists: 'PP Assists', powerPlayPoints: 'PP Points',
    shorthandedGoals: 'SH Goals', shorthandedAssists: 'SH Assists', shorthandedPoints: 'SH Points',
    gameWinningGoals: 'GWG',
    overtimeGoals: 'OT Goals', overtimeAssists: 'OT Assists',
    goalieWins: 'Wins', goalieSaves: 'Saves', shutouts: 'Shutouts',
    goalsAgainst: 'GA (penalty)',
    connSmytheTrophy: 'Conn Smythe',
  }

  const myStanding = standings.find(s => s.memberId === myMemberId)
  const myColor = myStanding?.colorPrimary ?? '#FF6B00'

  return (
    <div className="bg-white min-h-screen">
      <div className="p-4 max-w-xl mx-auto">
      <button onClick={() => router.back()} className="text-xs text-[#98989e] mb-3 font-semibold hover:text-[#515151]">
        ← Back
      </button>
      <div className="mb-4">
        <h1 className="text-xl font-black tracking-tight text-[#121212]">Standings</h1>
        <p className="text-xs text-[#98989e] font-semibold mt-0.5">Through {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
      </div>
      <div className="mb-4">
        {lastUpdated && (
          <p className="text-[10px] text-[#98989e]">Last updated: {lastUpdated}</p>
        )}
        <p className="text-[10px] text-[#98989e] mt-0.5">Stats update nightly at 11:00 PM and 2:00 AM ET</p>
      </div>
      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      {myStanding && (
        <div
          className="bg-[#1a1a1a] rounded-xl p-3 mb-4 flex items-center justify-between"
          style={{ borderLeft: `4px solid ${myColor}` }}
        >
          <div className="flex items-center gap-2.5">
            <div className="text-xl font-black text-white">{myStanding.rank}{ordinal(myStanding.rank)}</div>
            <div>
              <div className="text-xs font-bold text-white">{myStanding.teamName}</div>
              <div className="text-[10px] text-[#98989e]">You</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-base font-black" style={{ color: myColor }}>{myStanding.totalScore.toFixed(1)}</div>
            <div className="text-[9px] text-[#98989e] font-bold uppercase tracking-widest">Total FPTS</div>
          </div>
        </div>
      )}

      {/* Scoring settings collapsible */}
      {scoringSettings && (
        <div className="mb-6">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="text-xs text-orange-500 font-bold hover:text-orange-700"
          >
            {showSettings ? 'Hide' : 'Show'} Scoring Weights
          </button>
          {showSettings && (
            <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-gray-600 bg-gray-50 rounded-lg p-3">
              {Object.entries(SETTING_LABELS).map(([key, label]) => {
                const val = Number(scoringSettings[key] ?? 0)
                if (val === 0) return null
                return (
                  <div key={key} className="flex justify-between">
                    <span>{label}</span>
                    <span className="font-bold text-orange-500">{val.toFixed(2)}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Standings table */}
      {standings.length > 0 && (
        <div className="border border-[#eeeeee] rounded-xl overflow-hidden mb-4">
          {/* Table header */}
          <div className="bg-[#f8f8f8] flex items-center px-4 py-2 border-b border-[#eeeeee]">
            <span className="w-8 text-[9px] font-bold uppercase tracking-widest text-[#98989e] text-right">RK</span>
            <span className="w-8 mx-2" />
            <span className="flex-1 text-[9px] font-bold uppercase tracking-widest text-[#98989e]">Team</span>
            <span className="w-14 text-[9px] font-bold uppercase tracking-widest text-[#98989e] text-right">YDAY</span>
            <span className="w-16 text-[9px] font-bold uppercase tracking-widest text-[#0042bb] text-right">TOTAL</span>
          </div>
          {standings.map(member => {
            const isMe = member.memberId === myMemberId
            return (
              <div
                key={member.memberId}
                className="border-b border-[#f5f5f5] last:border-0"
                style={isMe ? { borderLeft: `3px solid ${member.colorPrimary ?? '#FF6B00'}`, backgroundColor: '#fff8f8' } : undefined}
              >
                <button
                  onClick={() => setExpandedMember(expandedMember === member.memberId ? null : member.memberId)}
                  className="w-full flex items-center px-4 py-3 hover:bg-gray-50 transition text-left"
                >
                  <span className="w-8 text-lg font-black text-gray-300 text-right">{member.rank}</span>
                  <span className="mx-2"><TeamIcon icon={member.teamIcon} /></span>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm truncate">{member.teamName}</p>
                    <p className="text-xs text-gray-400">{member.userName}</p>
                  </div>
                  <span className={`w-14 text-right text-xs font-semibold ${
                    member.yesterdayFpts !== null && member.yesterdayFpts > 0
                      ? 'text-[#2db944]'
                      : member.yesterdayFpts !== null && member.yesterdayFpts < 0
                      ? 'text-[#c8102e]'
                      : 'text-[#98989e]'
                  }`}>
                    {member.yesterdayFpts !== null && member.yesterdayFpts > 0
                      ? `+${member.yesterdayFpts.toFixed(1)}`
                      : member.yesterdayFpts === 0
                      ? '0.0'
                      : member.yesterdayFpts !== null
                      ? member.yesterdayFpts.toFixed(1)
                      : '—'}
                  </span>
                  <span className="w-16 text-right text-sm font-black text-[#0042bb]">
                    {member.totalScore.toFixed(1)}
                  </span>
                </button>

                {/* Expanded roster */}
                {expandedMember === member.memberId && (
                  <div className="px-4 pb-4">
                    {member.players
                      .sort((a, b) => b.totalPoints - a.totalPoints)
                      .map(player => (
                        <Link
                          key={player.playerId}
                          href={`/league/${id}/players/${player.playerId}`}
                          className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-gray-50 transition"
                        >
                          {player.headshotUrl ? (
                            <img src={player.headshotUrl} alt="" className="w-8 h-8 rounded-full bg-gray-100" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-gray-200" />
                          )}
                          <div className="flex-1">
                            <p className={`text-sm font-semibold ${player.isEliminated ? 'text-gray-400 line-through' : ''}`}>
                              {player.name}
                            </p>
                            <p className="text-xs text-gray-400">{player.position} · {player.teamAbbrev}</p>
                          </div>
                          <span className={`text-sm font-bold ${player.isEliminated ? 'text-gray-400' : 'text-[#0042bb]'}`}>
                            {player.totalPoints.toFixed(1)}
                          </span>
                        </Link>
                      ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      </div>
    </div>
  )
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return s[(v - 20) % 10] ?? s[v] ?? s[0]
}
