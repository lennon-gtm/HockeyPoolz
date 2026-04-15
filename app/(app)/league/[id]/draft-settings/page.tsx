'use client'
import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@/lib/firebase/client'
import { RosterSliders, type RosterValues } from '@/components/roster-sliders'

interface LeagueDetail {
  id: string
  commissionerId: string
  rosterForwards: number
  rosterDefense: number
  rosterGoalies: number
  status: string
  draft: {
    id: string
    scheduledStartAt: string | null
    pickTimeLimitSecs: number
    status: string
  } | null
}

export default function DraftSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [league, setLeague] = useState<LeagueDetail | null>(null)
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [roster, setRoster] = useState<RosterValues>({ rosterForwards: 9, rosterDefense: 4, rosterGoalies: 2 })
  const [scheduledDate, setScheduledDate] = useState('')
  const [scheduledTime, setScheduledTime] = useState('')
  const [pickTimeLimitSecs, setPickTimeLimitSecs] = useState(90)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      const token = await auth.currentUser?.getIdToken()
      if (!token) return
      const headers = { Authorization: `Bearer ${token}` }
      const [leagueRes, draftRes, meRes] = await Promise.all([
        fetch(`/api/leagues/${id}`, { headers }),
        fetch(`/api/leagues/${id}/draft`, { headers }),
        fetch('/api/auth/me', { headers }),
      ])
      if (!leagueRes.ok || !meRes.ok) { setError('Failed to load'); return }
      const leagueJson = await leagueRes.json()
      const draftJson = draftRes.ok ? await draftRes.json() : { draft: null }
      const meJson = await meRes.json()
      const merged: LeagueDetail = { ...leagueJson.league, draft: draftJson.draft }
      setLeague(merged)
      setMyUserId(meJson.user.id)
      setRoster({
        rosterForwards: merged.rosterForwards,
        rosterDefense: merged.rosterDefense,
        rosterGoalies: merged.rosterGoalies,
      })
      if (merged.draft?.scheduledStartAt) {
        const d = new Date(merged.draft.scheduledStartAt)
        setScheduledDate(d.toISOString().slice(0, 10))
        setScheduledTime(d.toTimeString().slice(0, 5))
      }
      if (merged.draft) setPickTimeLimitSecs(merged.draft.pickTimeLimitSecs)
    }
    load()
  }, [id])

  if (!league) return <div className="p-6 text-sm text-[#98989e]">Loading…</div>

  const isCommissioner = myUserId === league.commissionerId
  const locked = league.status !== 'setup'
  const lockedByTime = !!league.draft?.scheduledStartAt
    && new Date(league.draft.scheduledStartAt).getTime() - Date.now() < 60_000
  const disabled = !isCommissioner || locked || lockedByTime

  async function save() {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const token = await auth.currentUser?.getIdToken()
      if (!token) { setError('Not signed in'); return }
      const scheduledStartAt = scheduledDate && scheduledTime
        ? new Date(`${scheduledDate}T${scheduledTime}:00`).toISOString()
        : null
      const res = await fetch(`/api/leagues/${id}/schedule`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...roster, scheduledStartAt, pickTimeLimitSecs }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Failed to save')
        return
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally { setSaving(false) }
  }

  return (
    <div className="bg-white min-h-screen">
      <div className="p-4 max-w-xl mx-auto">
        <button onClick={() => router.back()} className="text-xs text-[#98989e] mb-3 font-semibold hover:text-[#515151]">
          ← Back
        </button>
        <h1 className="text-xl font-black tracking-tight text-[#121212] mb-1">Draft Settings</h1>
        <p className="text-xs text-[#98989e] font-semibold mb-6">
          {isCommissioner ? 'Commissioner-only · Editable until 1 minute before draft start' : 'Read-only'}
        </p>
        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

        <section className="mb-8">
          <p className="text-xs font-bold text-[#98989e] uppercase tracking-widest mb-3">Roster</p>
          <RosterSliders value={roster} onChange={setRoster} disabled={disabled} />
        </section>

        <section className="mb-8">
          <p className="text-xs font-bold text-[#98989e] uppercase tracking-widest mb-3">Draft Schedule</p>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <input
              type="date"
              value={scheduledDate}
              disabled={disabled}
              onChange={e => setScheduledDate(e.target.value)}
              className="border-2 border-[#eeeeee] rounded-xl p-3 text-sm focus:border-orange-500 outline-none disabled:opacity-50"
            />
            <input
              type="time"
              value={scheduledTime}
              disabled={disabled}
              onChange={e => setScheduledTime(e.target.value)}
              className="border-2 border-[#eeeeee] rounded-xl p-3 text-sm focus:border-orange-500 outline-none disabled:opacity-50"
            />
          </div>
          <p className="text-[10px] text-[#98989e]">Editable until 1 minute before draft start.</p>
        </section>

        <section className="mb-8">
          <p className="text-xs font-bold text-[#98989e] uppercase tracking-widest mb-3">Pick Timer</p>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-semibold text-[#121212]">Seconds per pick</label>
            <span className="text-sm font-black text-[#121212]">{pickTimeLimitSecs}s</span>
          </div>
          <input
            type="range"
            min={30}
            max={300}
            step={5}
            value={pickTimeLimitSecs}
            disabled={disabled}
            onChange={e => setPickTimeLimitSecs(Number(e.target.value))}
            className="w-full accent-orange-500 disabled:opacity-50"
          />
        </section>

        <section className="mb-8">
          <p className="text-xs font-bold text-[#98989e] uppercase tracking-widest mb-3">Scoring</p>
          <Link
            href={`/league/${id}/settings`}
            className="block text-center py-3 border-2 border-[#eeeeee] rounded-xl text-sm font-bold text-[#121212] hover:border-gray-400 transition"
          >
            Scoring Settings →
          </Link>
        </section>

        {isCommissioner && (
          <button
            onClick={save}
            disabled={saving || disabled}
            className="w-full py-3 rounded-xl font-bold text-white bg-orange-500 hover:bg-orange-600 transition disabled:opacity-40"
          >
            {saved ? '✓ Saved!' : saving ? 'Saving…' : 'Save Settings'}
          </button>
        )}
      </div>
    </div>
  )
}
