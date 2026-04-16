'use client'
import { useState, useEffect, use } from 'react'
import { auth } from '@/lib/firebase/client'

interface GameSummary {
  id: string
  gameId: string
  gameDate: string
  homeTeamId: string
  awayTeamId: string
  homeScore: number
  awayScore: number
  gameState: string
  seriesStatus: string | null
  articleUrl: string | null
  content: string
}

export default function ScoresPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [games, setGames] = useState<GameSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [date, setDate] = useState('')

  useEffect(() => {
    async function load() {
      const token = await auth.currentUser?.getIdToken()
      if (!token) { setLoading(false); return }
      const res = await fetch(`/api/leagues/${id}/scores`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setGames(data.games ?? [])
        if (data.games?.length > 0) {
          setDate(new Date(data.games[0].gameDate).toLocaleDateString('en-US', {
            weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
          }))
        }
      }
      setLoading(false)
    }
    load()
  }, [id])

  if (loading) return <div className="p-6 text-sm text-[#98989e]">Loading…</div>

  return (
    <div className="p-4 max-w-xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[10px] font-black tracking-[2px] uppercase text-[#121212]">Yesterday&apos;s Games</h2>
        {date && <span className="text-[10px] text-[#98989e] font-semibold">{date}</span>}
      </div>

      {games.length === 0 ? (
        <div className="border border-[#eeeeee] rounded-xl p-8 text-center">
          <p className="text-sm text-[#98989e]">No games yesterday.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {games.map(game => {
            const homeWon = game.homeScore > game.awayScore
            return (
              <div key={game.id} className="bg-white rounded-2xl border border-[#eeeeee] overflow-hidden">
                {/* Score header */}
                <div className="px-4 pt-4 pb-3 border-b border-[#f2f2f2]">
                  <div className="flex items-center justify-between mb-2.5">
                    {/* Away team */}
                    <div className="flex items-center gap-2 flex-1">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`https://assets.nhle.com/logos/nhl/svg/${game.awayTeamId}_light.svg`}
                        alt={game.awayTeamId}
                        className="w-9 h-9 object-contain"
                      />
                      <span className="text-[11px] font-black uppercase tracking-wide text-[#121212]">{game.awayTeamId}</span>
                    </div>
                    {/* Score */}
                    <div className="flex items-center gap-2 px-2">
                      <span className={`text-2xl font-black leading-none ${!homeWon ? 'text-[#121212]' : 'text-[#c8c8c8]'}`}>
                        {game.awayScore}
                      </span>
                      <span className="text-base text-[#d8d8d8] font-light">–</span>
                      <span className={`text-2xl font-black leading-none ${homeWon ? 'text-[#121212]' : 'text-[#c8c8c8]'}`}>
                        {game.homeScore}
                      </span>
                    </div>
                    {/* Home team */}
                    <div className="flex items-center gap-2 flex-1 flex-row-reverse">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`https://assets.nhle.com/logos/nhl/svg/${game.homeTeamId}_light.svg`}
                        alt={game.homeTeamId}
                        className="w-9 h-9 object-contain"
                      />
                      <span className="text-[11px] font-black uppercase tracking-wide text-[#121212]">{game.homeTeamId}</span>
                    </div>
                  </div>
                  {/* Badges */}
                  <div className="flex items-center justify-center gap-2">
                    <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-[#f0f0f0] text-[#515151]">
                      {game.gameState === 'OFF' || game.gameState === 'OFFICIAL' ? 'Final' : game.gameState}
                    </span>
                    {game.seriesStatus && (
                      <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-[#eef3ff] text-[#0042bb]">
                        {game.seriesStatus}
                      </span>
                    )}
                  </div>
                </div>

                {/* Commentary */}
                <div className="px-4 py-3 border-b border-[#f2f2f2]">
                  <p className="text-[13px] leading-relaxed text-[#2a2a2a]">{game.content}</p>
                </div>

                {/* Footer */}
                {game.articleUrl && (
                  <div className="px-4 py-2.5">
                    <a
                      href={game.articleUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] font-bold text-[#0042bb] hover:underline"
                    >
                      Read full recap →
                    </a>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
