'use client'
import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import { auth } from '@/lib/firebase/client'

interface League { id: string; name: string; commissioner: { displayName: string }; members: { id: string }[]; maxTeams: number }

export default function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params)
  const router = useRouter()
  const [league, setLeague] = useState<League | null>(null)
  const [teamName, setTeamName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`/api/leagues/by-code/${code}`).then(r => r.json()).then(d => {
      if (d.league) setLeague(d.league)
      else setError('Invalid invite link')
    })
  }, [code])

  async function join() {
    if (!league) return
    setLoading(true)
    setError('')
    try {
      const token = await auth.currentUser?.getIdToken()
      if (!token) { setError('Not signed in. Please reload.'); return }
      const res = await fetch(`/api/leagues/${league.id}/join`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamName, inviteCode: code }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error); return }
      router.push(`/league/${league.id}`)
    } catch {
      setError('Failed to join league')
    } finally {
      setLoading(false)
    }
  }

  if (error && !league) return <div className="p-6 text-red-600">{error}</div>
  if (!league) return <div className="p-6 text-gray-400 text-sm">Loading…</div>

  return (
    <div className="min-h-screen bg-white p-6 max-w-sm mx-auto flex flex-col justify-center">
      <h1 className="text-xl font-black tracking-widest mb-1">HOCKEYPOOLZ</h1>
      <p className="text-gray-500 text-sm mb-6">You&apos;ve been invited to join a league</p>
      <div className="bg-gray-50 rounded-xl p-4 mb-6">
        <p className="font-bold text-lg">{league.name}</p>
        <p className="text-sm text-gray-500">Created by {league.commissioner.displayName}</p>
        <p className="text-sm text-gray-500">{league.members.length}/{league.maxTeams} teams</p>
      </div>
      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
      <label className="text-sm font-semibold mb-1 block">Your Team Name</label>
      <input className="w-full border-2 border-gray-200 rounded-xl p-3 mb-4 focus:border-orange-500 outline-none"
        value={teamName} onChange={e => setTeamName(e.target.value)} placeholder="e.g. BobsTeam" />
      <button onClick={join} disabled={loading || !teamName.trim()}
        className="w-full py-3 rounded-xl font-bold text-white bg-orange-500 hover:bg-orange-600 transition disabled:opacity-40">
        {loading ? 'Joining…' : 'Join League'}
      </button>
    </div>
  )
}
