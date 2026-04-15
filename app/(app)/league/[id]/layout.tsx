'use client'
import { useState, useEffect, use } from 'react'
import { auth } from '@/lib/firebase/client'
import { LeagueNav } from '@/components/league-nav'

export default function LeagueLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const [color, setColor] = useState<string>('#FF6B00')

  useEffect(() => {
    async function loadColor() {
      const token = await auth.currentUser?.getIdToken()
      if (!token) return
      const [meRes, leagueRes] = await Promise.all([
        fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/leagues/${id}`, { headers: { Authorization: `Bearer ${token}` } }),
      ])
      if (!meRes.ok || !leagueRes.ok) return
      const me = await meRes.json()
      const league = await leagueRes.json()
      const myMember = league.league?.members?.find((m: { user: { id: string } }) => m.user.id === me.user.id)
      const c = myMember?.favoriteTeam?.colorPrimary ?? '#FF6B00'
      setColor(c)
    }
    loadColor()
  }, [id])

  return (
    <>
      <LeagueNav leagueId={id} color={color} />
      {children}
    </>
  )
}
