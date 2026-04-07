'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { auth } from '@/lib/firebase/client'

export default function CreateLeaguePage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [maxTeams, setMaxTeams] = useState(8)
  const [playersPerTeam, setPlayersPerTeam] = useState(10)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function create() {
    setLoading(true)
    setError('')
    try {
      const token = await auth.currentUser?.getIdToken()
      const res = await fetch('/api/leagues', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, maxTeams, playersPerTeam }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error); return }
      router.push(`/league/${data.league.id}`)
    } catch {
      setError('Failed to create league')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-white p-6 max-w-lg mx-auto">
      <h1 className="text-2xl font-black tracking-widest mb-6">Create League</h1>
      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
      <label className="block text-sm font-semibold mb-1">League Name</label>
      <input className="w-full border-2 border-gray-200 rounded-xl p-3 mb-4 focus:border-orange-500 outline-none"
        value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Office Pool 2026" />
      <label className="block text-sm font-semibold mb-1">Max Teams ({maxTeams})</label>
      <input type="range" min={2} max={20} value={maxTeams} onChange={e => setMaxTeams(+e.target.value)}
        className="w-full mb-4 accent-orange-500" />
      <label className="block text-sm font-semibold mb-1">Players per Team ({playersPerTeam})</label>
      <input type="range" min={4} max={20} value={playersPerTeam} onChange={e => setPlayersPerTeam(+e.target.value)}
        className="w-full mb-6 accent-orange-500" />
      <button onClick={create} disabled={loading || !name.trim()}
        className="w-full py-3 rounded-xl font-bold text-white bg-orange-500 hover:bg-orange-600 transition disabled:opacity-40">
        {loading ? 'Creating…' : 'Create League'}
      </button>
    </div>
  )
}
