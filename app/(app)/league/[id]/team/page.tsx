'use client'
import { useState, useEffect, use } from 'react'
import { auth } from '@/lib/firebase/client'
import { TeamIcon } from '@/components/team-icon'
import { PositionBadge, type PlayerPosition } from '@/components/position-badge'
import { StatCard } from '@/components/stat-card'

interface Member {
  id: string
  teamName: string
  teamIcon: string | null
  user: { id: string; displayName: string }
  totalScore: number
  favoriteTeam?: { colorPrimary: string } | null
}

interface LeagueDetail {
  id: string
  name: string
  members: Member[]
}

interface DraftedPlayer {
  playerId: string
  fullName: string
  position: PlayerPosition
  nhlTeamAbbrev: string
  totalFpts: number
}

export default function MyTeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [league, setLeague] = useState<LeagueDetail | null>(null)
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [roster, setRoster] = useState<DraftedPlayer[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const token = await auth.currentUser?.getIdToken()
      if (!token) return
      const headers = { Authorization: `Bearer ${token}` }
      const [meRes, leagueRes] = await Promise.all([
        fetch('/api/auth/me', { headers }),
        fetch(`/api/leagues/${id}`, { headers }),
      ])
      const me = await meRes.json()
      const leagueData = await leagueRes.json()
      setMyUserId(me.user.id)
      setLeague(leagueData.league)
      setLoading(false)
    }
    load()
  }, [id])

  if (loading || !league) {
    return <div className="p-6 text-sm text-[#98989e]">Loading…</div>
  }

  const myMember = league.members.find(m => m.user.id === myUserId)
  if (!myMember) {
    return <div className="p-6 text-sm text-[#98989e]">You&apos;re not a member of this league.</div>
  }

  const myColor = myMember.favoriteTeam?.colorPrimary ?? '#FF6B00'
  const myRank = [...league.members]
    .sort((a, b) => Number(b.totalScore) - Number(a.totalScore))
    .findIndex(m => m.id === myMember.id) + 1

  return (
    <div className="p-4 max-w-xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <TeamIcon icon={myMember.teamIcon} size="lg" />
          <div>
            <div className="text-lg font-black tracking-tight text-[#121212]">{myMember.teamName}</div>
            <div className="text-xs text-[#98989e] font-semibold">{myMember.user.displayName}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-black" style={{ color: myColor }}>{Number(myMember.totalScore).toFixed(1)}</div>
          <div className="text-[9px] text-[#98989e] font-bold uppercase tracking-widest">Total FPTS</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5 mb-4">
        <StatCard value={`${myRank}${ordinal(myRank)}`} label="Standing" />
        <StatCard value="—" label="Yesterday" />
        <StatCard value="📰" label="Recap" tone="dark" />
      </div>

      <div className="border border-[#eeeeee] rounded-xl p-6 text-center">
        <p className="text-xs text-[#98989e] font-semibold">Your roster will appear here after the draft.</p>
        <p className="text-[10px] text-[#98989e] mt-2">{roster.length} players drafted</p>
      </div>
    </div>
  )
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return s[(v - 20) % 10] ?? s[v] ?? s[0]
}
