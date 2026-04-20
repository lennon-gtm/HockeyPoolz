'use client'
import { useState, useEffect, use } from 'react'
import { auth } from '@/lib/firebase/client'
import { useRouter } from 'next/navigation'
import { InjuryBadge, type InjuryStatus } from '@/components/injury-badge'

interface GameLogEntry {
  gameId: string; gameDate: string
  stats: Record<string, number>
  weightedScore: number
}
interface PlayerDetail {
  id: number; name: string; position: string
  team: { abbreviation: string; name: string; isEliminated: boolean }
  headshotUrl: string | null
  injuryStatus: InjuryStatus | null
  totals: Record<string, number> & { weightedTotal: number }
  gameLog: GameLogEntry[]
}

const SKATER_STAT_COLS = [
  { key: 'goals', label: 'G' }, { key: 'assists', label: 'A' },
  { key: 'plusMinus', label: '+/-' }, { key: 'pim', label: 'PIM' },
  { key: 'shots', label: 'SOG' }, { key: 'hits', label: 'HIT' },
  { key: 'blockedShots', label: 'BLK' },
  { key: 'powerPlayGoals', label: 'PPG' }, { key: 'powerPlayPoints', label: 'PPP' },
  { key: 'shorthandedGoals', label: 'SHG' }, { key: 'gameWinningGoals', label: 'GWG' },
  { key: 'overtimeGoals', label: 'OTG' },
]

const GOALIE_STAT_COLS = [
  { key: 'goalieWins', label: 'W' }, { key: 'goalieSaves', label: 'SV' },
  { key: 'goalsAgainst', label: 'GA' }, { key: 'shutouts', label: 'SO' },
]

export default function PlayerDetailPage({ params }: { params: Promise<{ id: string; playerId: string }> }) {
  const { id, playerId } = use(params)
  const router = useRouter()
  const [player, setPlayer] = useState<PlayerDetail | null>(null)
  const [error, setError] = useState('')
  const [myColor, setMyColor] = useState('#FF6B00')

  useEffect(() => {
    async function load() {
      try {
        const token = await auth.currentUser?.getIdToken()
        if (!token) { setError('Not signed in.'); return }

        const [playerRes, leagueRes, meRes] = await Promise.all([
          fetch(`/api/leagues/${id}/players/${playerId}`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`/api/leagues/${id}`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } }),
        ])

        if (!playerRes.ok) { setError('Failed to load player.'); return }
        const data = await playerRes.json()
        setPlayer(data.player)

        if (leagueRes.ok && meRes.ok) {
          const [leagueData, meData] = await Promise.all([leagueRes.json(), meRes.json()])
          const myUserId = meData.user?.id
          const myMember = leagueData.league?.members?.find(
            (m: { user: { id: string }; favoriteTeam?: { colorPrimary?: string } }) => m.user?.id === myUserId
          )
          if (myMember?.favoriteTeam?.colorPrimary) {
            setMyColor(myMember.favoriteTeam.colorPrimary)
          }
        }
      } catch {
        setError('Failed to load player.')
      }
    }
    load()
  }, [id, playerId])

  if (!player) return <div className="p-6 text-gray-400 text-sm">Loading...</div>

  const isGoalie = player.position === 'G'
  const statCols = isGoalie ? GOALIE_STAT_COLS : SKATER_STAT_COLS

  return (
    <div className="min-h-screen bg-white max-w-3xl mx-auto">
      {/* Color accent strip */}
      <div className="h-1" style={{ backgroundColor: myColor }} />

      <div className="p-6">
        <button onClick={() => router.back()} className="text-sm text-gray-400 mb-4 hover:text-gray-600">
          ← Back
        </button>
        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

        {/* Player header */}
        <div className="flex items-center gap-4 mb-6">
          {player.headshotUrl ? (
            <img src={player.headshotUrl} alt="" className="w-16 h-16 rounded-full bg-gray-100" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-gray-200" />
          )}
          <div>
            <div className="flex items-center gap-2">
              <h1 className={`text-2xl font-black ${player.team.isEliminated ? 'text-gray-400' : ''}`}>
                {player.name}
              </h1>
              <InjuryBadge status={player.injuryStatus} />
            </div>
            <p className="text-sm text-gray-500">
              {player.position} · {player.team.name} ({player.team.abbreviation})
              {player.team.isEliminated && (
                <span className="ml-2 text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded font-bold">ELIMINATED</span>
              )}
            </p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-3xl font-black text-orange-500">{player.totals.weightedTotal.toFixed(2)}</p>
            <p className="text-xs text-gray-400">Total Points</p>
          </div>
        </div>

        {/* Season totals */}
        <div className="grid grid-cols-4 gap-3 mb-8">
          {statCols.map(({ key, label }) => (
            <div key={key} className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-400 font-bold">{label}</p>
              <p className="text-lg font-black">{player.totals[key] ?? 0}</p>
            </div>
          ))}
        </div>

        {/* Game log table */}
        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Game Log</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-gray-200">
                <th className="text-left py-2 pr-4 font-bold text-gray-400">Date</th>
                {statCols.map(({ label }) => (
                  <th key={label} className="text-center py-2 px-2 font-bold text-gray-400">{label}</th>
                ))}
                <th className="text-right py-2 pl-4 font-bold text-orange-400">PTS</th>
              </tr>
            </thead>
            <tbody>
              {player.gameLog.map(game => (
                <tr key={game.gameId} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 pr-4 text-gray-600">{game.gameDate}</td>
                  {statCols.map(({ key }) => (
                    <td key={key} className="text-center py-2 px-2">
                      {game.stats[key] ?? 0}
                    </td>
                  ))}
                  <td className="text-right py-2 pl-4 font-bold text-orange-500">
                    {game.weightedScore.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
