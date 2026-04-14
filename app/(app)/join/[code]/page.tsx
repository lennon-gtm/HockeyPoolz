'use client'
import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import { auth } from '@/lib/firebase/client'
import { TeamSetupForm, type TeamSetupValues } from '@/components/team-setup-form'

interface League { id: string; name: string; commissioner: { displayName: string }; members: { id: string }[]; maxTeams: number }

type Step = 'welcome' | 'team-setup'

export default function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params)
  const router = useRouter()
  const [league, setLeague] = useState<League | null>(null)
  const [step, setStep] = useState<Step>('welcome')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`/api/leagues/by-code/${code}`).then(r => r.json()).then(d => {
      if (d.league) setLeague(d.league)
      else setError('Invalid invite link')
    })
  }, [code])

  async function submitJoin(values: TeamSetupValues) {
    if (!league) return
    setLoading(true)
    setError('')
    try {
      const token = await auth.currentUser?.getIdToken()
      if (!token) { setError('Not signed in. Please reload.'); return }
      const res = await fetch(`/api/leagues/${league.id}/join`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, inviteCode: code }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to join league'); return }
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
    <div className="min-h-screen bg-white p-6 max-w-sm mx-auto">
      <h1 className="text-xl font-black tracking-widest mb-1">HOCKEYPOOLZ</h1>

      {step === 'welcome' && (
        <>
          <p className="text-gray-500 text-sm mb-6">You&apos;ve been invited to join a league</p>
          <div className="bg-gray-50 rounded-xl p-4 mb-6">
            <p className="font-bold text-lg">{league.name}</p>
            <p className="text-sm text-gray-500">Created by {league.commissioner.displayName}</p>
            <p className="text-sm text-gray-500">{league.members.length}/{league.maxTeams} teams</p>
          </div>
          <button
            onClick={() => setStep('team-setup')}
            className="w-full py-3 rounded-xl font-bold text-white bg-orange-500 hover:bg-orange-600 transition"
          >
            Join this league →
          </button>
        </>
      )}

      {step === 'team-setup' && (
        <>
          <p className="text-gray-500 text-sm mb-6">Set up your team for {league.name}</p>
          {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
          <TeamSetupForm
            submitLabel="Join League →"
            loading={loading}
            onSubmit={submitJoin}
          />
          <button
            onClick={() => setStep('welcome')}
            className="w-full py-2 text-sm text-gray-500 mt-2 hover:text-gray-700"
          >
            ← Back
          </button>
        </>
      )}
    </div>
  )
}
