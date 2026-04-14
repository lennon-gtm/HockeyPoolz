'use client'
import { useState, useEffect, use } from 'react'
import { auth } from '@/lib/firebase/client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

function safeIcon(icon: string | null): string {
  if (!icon || icon.startsWith('http')) return '🏒'
  return icon
}

interface PlayerStanding {
  playerId: number; name: string; position: string; teamAbbrev: string
  headshotUrl: string | null; totalPoints: number; isEliminated: boolean
  stats: Record<string, number>
}
interface MemberStanding {
  rank: number; memberId: string; teamName: string; teamIcon: string | null
  userName: string; totalScore: number; scoreLastCalculatedAt: string | null
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

  useEffect(() => {
    async function load() {
      try {
        const token = await auth.currentUser?.getIdToken()
        if (!token) { setError('Not signed in.'); return }
        const res = await fetch(`/api/leagues/${id}/standings`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) { setError('Failed to load standings.'); return }
        const data = await res.json()
        setStandings(data.standings)
        setScoringSettings(data.scoringSettings)
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
    powerPlayGoals: 'PP Goals', powerPlayPoints: 'PP Points',
    shorthandedGoals: 'SH Goals', shorthandedPoints: 'SH Points',
    gameWinningGoals: 'GWG', overtimeGoals: 'OT Goals',
    goalieWins: 'Wins', goalieSaves: 'Saves', shutouts: 'Shutouts',
    goalsAgainst: 'GA (penalty)',
  }

  return (
    <div className="min-h-screen bg-white p-6 max-w-2xl mx-auto">
      <button onClick={() => router.back()} className="text-sm text-gray-400 mb-4 hover:text-gray-600">
        ← Back
      </button>
      <h1 className="text-2xl font-black tracking-widest mb-1">Standings</h1>
      {lastUpdated && (
        <p className="text-xs text-gray-400 mb-6">Last updated: {lastUpdated}</p>
      )}
      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

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
                    <span className="font-bold text-orange-500">{val.toFixed(1)}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Leaderboard */}
      {standings.map(member => (
        <div key={member.memberId} className="border-b border-gray-100">
          <button
            onClick={() => setExpandedMember(expandedMember === member.memberId ? null : member.memberId)}
            className="w-full flex items-center gap-3 p-4 hover:bg-gray-50 transition text-left"
          >
            <span className="text-lg font-black text-gray-300 w-8 text-right">{member.rank}</span>
            <span className="text-2xl">{safeIcon(member.teamIcon)}</span>
            <div className="flex-1">
              <p className="font-bold text-sm">{member.teamName}</p>
              <p className="text-xs text-gray-400">{member.userName}</p>
            </div>
            <span className="text-lg font-black text-orange-500">{member.totalScore.toFixed(1)}</span>
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
                    <span className={`text-sm font-bold ${player.isEliminated ? 'text-gray-400' : 'text-orange-500'}`}>
                      {player.totalPoints.toFixed(1)}
                    </span>
                  </Link>
                ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
