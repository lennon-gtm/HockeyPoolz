'use client'
import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import { auth } from '@/lib/firebase/client'

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

export default function ScoringSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [settings, setSettings] = useState<ScoringSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const token = await auth.currentUser?.getIdToken()
        if (!token) { setError('Not signed in. Please reload.'); return }
        const res = await fetch(`/api/leagues/${id}/scoring`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) { setError('Failed to load settings.'); return }
        const data = await res.json()
        setSettings(data.settings)
      } catch {
        setError('Failed to load settings.')
      }
    }
    load()
  }, [id])

  async function save() {
    if (!settings) return
    setSaving(true)
    setError('')
    try {
      const token = await auth.currentUser?.getIdToken()
      if (!token) { setError('Not signed in. Please reload.'); return }
      const res = await fetch(`/api/leagues/${id}/scoring`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error); return }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      setError('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  if (!settings) return <div className="p-6 text-gray-400 text-sm">Loading…</div>

  return (
    <div className="min-h-screen bg-white p-6 max-w-lg mx-auto">
      <button onClick={() => router.back()} className="text-sm text-gray-400 mb-4 hover:text-gray-600">← Back</button>
      <h1 className="text-2xl font-black tracking-widest mb-6">Scoring Settings</h1>
      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
      <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Skater Categories</p>
      {Object.entries(SKATER_LABELS).map(([field, label]) => (
        <div key={field} className="mb-5">
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-semibold">{label}</label>
            <span className="text-sm font-bold text-orange-500">{Number(settings[field as keyof ScoringSettings]).toFixed(1)} pts</span>
          </div>
          <input
            type="range" min={0} max={10} step={0.5}
            value={Number(settings[field as keyof ScoringSettings])}
            onChange={e => setSettings(s => s ? { ...s, [field]: parseFloat(e.target.value) } : s)}
            className="w-full accent-orange-500"
          />
        </div>
      ))}

      <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 mt-8">Goalie Categories</p>
      {Object.entries(GOALIE_LABELS).map(([field, label]) => (
        <div key={field} className="mb-5">
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-semibold">{label}</label>
            <span className="text-sm font-bold text-orange-500">{Number(settings[field as keyof ScoringSettings]).toFixed(1)} pts</span>
          </div>
          <input
            type="range" min={0} max={10} step={0.5}
            value={Number(settings[field as keyof ScoringSettings])}
            onChange={e => setSettings(s => s ? { ...s, [field]: parseFloat(e.target.value) } : s)}
            className="w-full accent-orange-500"
          />
        </div>
      ))}
      <button onClick={save} disabled={saving}
        className="w-full py-3 rounded-xl font-bold text-white bg-orange-500 hover:bg-orange-600 transition disabled:opacity-40 mt-2">
        {saved ? '✓ Saved!' : saving ? 'Saving…' : 'Save Settings'}
      </button>
    </div>
  )
}
