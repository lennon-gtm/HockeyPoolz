'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { auth } from '@/lib/firebase/client'
import { TeamSetupForm, type TeamSetupValues } from '@/components/team-setup-form'

type Step = 'settings' | 'invite' | 'scoring' | 'team-setup'

interface CreatedLeague { id: string; inviteCode: string; name: string }

interface ScoringSettings {
  goals: number; assists: number; plusMinus: number; pim: number
  shots: number; goalieWins: number; goalieSaves: number; shutouts: number
  hits: number; blockedShots: number; powerPlayGoals: number; powerPlayPoints: number
  shorthandedGoals: number; shorthandedPoints: number; gameWinningGoals: number
  overtimeGoals: number; goalsAgainst: number
}

const SKATER_LABELS: Record<string, string> = {
  goals: 'Goals', assists: 'Assists', plusMinus: '+/-', pim: 'Penalty Minutes',
  shots: 'Shots on Goal', hits: 'Hits', blockedShots: 'Blocked Shots',
  powerPlayGoals: 'Power Play Goals', powerPlayPoints: 'Power Play Points',
  shorthandedGoals: 'Shorthanded Goals', shorthandedPoints: 'Shorthanded Points',
  gameWinningGoals: 'Game-Winning Goals', overtimeGoals: 'Overtime Goals',
}

const GOALIE_LABELS: Record<string, string> = {
  goalieWins: 'Wins', goalieSaves: 'Saves', shutouts: 'Shutouts',
  goalsAgainst: 'Goals Against (penalty)',
}

export default function CreateLeaguePage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('settings')
  const [league, setLeague] = useState<CreatedLeague | null>(null)

  // Step 1 state
  const [name, setName] = useState('')
  const [maxTeams, setMaxTeams] = useState(8)
  const [playersPerTeam, setPlayersPerTeam] = useState(10)

  // Step 3 state
  const [scoring, setScoring] = useState<ScoringSettings | null>(null)

  // Shared state
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function createLeague() {
    setLeague(null)
    setLoading(true)
    setError('')
    try {
      const token = await auth.currentUser?.getIdToken()
      if (!token) { setError('Not signed in. Please reload.'); return }
      const res = await fetch('/api/leagues', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, maxTeams, playersPerTeam }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error); return }
      setLeague(data.league)
      setScoring(data.league.scoringSettings)
      setStep('invite')
    } catch {
      setError('Failed to create league')
    } finally {
      setLoading(false)
    }
  }

  async function saveScoring() {
    if (!league || !scoring) return
    setLoading(true)
    setError('')
    try {
      const token = await auth.currentUser?.getIdToken()
      if (!token) { setError('Not signed in. Please reload.'); return }
      const res = await fetch(`/api/leagues/${league.id}/scoring`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(scoring),
      })
      if (!res.ok) { setError('Failed to save scoring'); return }
      setStep('team-setup')
    } catch {
      setError('Failed to save scoring')
    } finally {
      setLoading(false)
    }
  }

  async function submitTeam(values: TeamSetupValues) {
    if (!league) return
    setLoading(true)
    setError('')
    try {
      const token = await auth.currentUser?.getIdToken()
      if (!token) { setError('Not signed in. Please reload.'); return }
      const res = await fetch(`/api/leagues/${league.id}/join`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, inviteCode: league.inviteCode }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to create team'); return }
      router.push(`/league/${league.id}`)
    } catch {
      setError('Failed to create team')
    } finally {
      setLoading(false)
    }
  }

  const inviteUrl = league
    ? `${process.env.NEXT_PUBLIC_APP_URL ?? (typeof window !== 'undefined' ? window.location.origin : '')}/join/${league.inviteCode}`
    : ''

  function copyLink() {
    navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="min-h-screen bg-white p-6 max-w-lg mx-auto">
      <h1 className="text-2xl font-black tracking-widest mb-1">Create League</h1>
      <p className="text-xs text-gray-400 mb-6">
        Step {step === 'settings' ? 1 : step === 'invite' ? 2 : step === 'scoring' ? 3 : 4} of 4
      </p>
      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      {step === 'settings' && (
        <>
          <label className="block text-sm font-semibold mb-1">League Name</label>
          <input
            className="w-full border-2 border-gray-200 rounded-xl p-3 mb-4 focus:border-orange-500 outline-none"
            value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Office Pool 2026"
          />
          <label className="block text-sm font-semibold mb-1">Max Teams ({maxTeams})</label>
          <input type="range" min={2} max={20} value={maxTeams} onChange={e => setMaxTeams(+e.target.value)}
            className="w-full mb-4 accent-orange-500" />
          <label className="block text-sm font-semibold mb-1">Players per Team ({playersPerTeam})</label>
          <input type="range" min={4} max={20} value={playersPerTeam} onChange={e => setPlayersPerTeam(+e.target.value)}
            className="w-full mb-6 accent-orange-500" />
          <button onClick={createLeague} disabled={loading || !name.trim()}
            className="w-full py-3 rounded-xl font-bold text-white bg-orange-500 hover:bg-orange-600 transition disabled:opacity-40">
            {loading ? 'Creating…' : 'Create League →'}
          </button>
        </>
      )}

      {step === 'invite' && league && (
        <>
          <h2 className="text-lg font-bold mb-2">League created!</h2>
          <p className="text-sm text-gray-500 mb-4">Share this link with your friends so they can join.</p>
          <div className="bg-gray-50 rounded-xl p-4 mb-4">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Invite Link</p>
            <p className="text-sm text-gray-600 break-all mb-3">{inviteUrl}</p>
            <button onClick={copyLink}
              className="bg-orange-500 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-orange-600 transition">
              {copied ? '✓ Copied!' : 'Copy Link'}
            </button>
          </div>
          <button onClick={() => setStep('scoring')}
            className="w-full py-3 rounded-xl font-bold text-white bg-orange-500 hover:bg-orange-600 transition">
            Configure Scoring →
          </button>
        </>
      )}

      {step === 'scoring' && scoring && (
        <>
          <h2 className="text-lg font-bold mb-4">Scoring Settings</h2>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Skater Categories</p>
          {Object.entries(SKATER_LABELS).map(([field, label]) => (
            <div key={field} className="mb-5">
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-semibold">{label}</label>
                <span className="text-sm font-bold text-orange-500">{Number(scoring[field as keyof ScoringSettings]).toFixed(1)} pts</span>
              </div>
              <input
                type="range" min={0} max={10} step={0.5}
                value={Number(scoring[field as keyof ScoringSettings])}
                onChange={e => setScoring(s => s ? { ...s, [field]: parseFloat(e.target.value) } : s)}
                className="w-full accent-orange-500"
              />
            </div>
          ))}
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 mt-8">Goalie Categories</p>
          {Object.entries(GOALIE_LABELS).map(([field, label]) => (
            <div key={field} className="mb-5">
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-semibold">{label}</label>
                <span className="text-sm font-bold text-orange-500">{Number(scoring[field as keyof ScoringSettings]).toFixed(1)} pts</span>
              </div>
              <input
                type="range" min={0} max={10} step={0.5}
                value={Number(scoring[field as keyof ScoringSettings])}
                onChange={e => setScoring(s => s ? { ...s, [field]: parseFloat(e.target.value) } : s)}
                className="w-full accent-orange-500"
              />
            </div>
          ))}
          <button onClick={saveScoring} disabled={loading}
            className="w-full py-3 rounded-xl font-bold text-white bg-orange-500 hover:bg-orange-600 transition disabled:opacity-40 mt-2">
            {loading ? 'Saving…' : 'Next: Set Up Your Team →'}
          </button>
        </>
      )}

      {step === 'team-setup' && league && (
        <>
          <h2 className="text-lg font-bold mb-4">Set up your team</h2>
          <TeamSetupForm submitLabel="Finish →" loading={loading} onSubmit={submitTeam} />
        </>
      )}
    </div>
  )
}
