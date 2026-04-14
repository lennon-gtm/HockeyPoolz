'use client'
import { useState, useEffect, useRef } from 'react'
import { auth } from '@/lib/firebase/client'

export interface NhlTeam {
  id: string
  name: string
  city: string
  conference: string
  division: string
  colorPrimary: string
  colorSecondary: string
}

export interface TeamSetupValues {
  teamName: string
  teamIcon: string | null
  favoriteTeamId: string | null
}

interface Props {
  initialValues?: Partial<TeamSetupValues>
  submitLabel: string
  loading?: boolean
  onSubmit: (values: TeamSetupValues) => void | Promise<void>
}

const EMOJI_OPTIONS = ['🏒', '🦅', '🐺', '⚡', '🔥', '🦁', '🦊', '🐻', '🏆', '🥅']

export function TeamSetupForm({ initialValues, submitLabel, loading, onSubmit }: Props) {
  const [teamName, setTeamName] = useState(initialValues?.teamName ?? '')
  const [teamIcon, setTeamIcon] = useState<string | null>(initialValues?.teamIcon ?? '🏒')
  const [favoriteTeamId, setFavoriteTeamId] = useState<string | null>(initialValues?.favoriteTeamId ?? null)
  const [nhlTeams, setNhlTeams] = useState<NhlTeam[]>([])
  const [search, setSearch] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/nhl-teams').then(r => r.json()).then(d => setNhlTeams(d.teams ?? []))
  }, [])

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const token = await auth.currentUser?.getIdToken()
      if (!token) { setError('Not signed in. Please reload.'); return }
      const form = new FormData()
      form.append('image', file)
      const res = await fetch('/api/uploads/team-icon', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Upload failed'); return }
      setTeamIcon(data.url)
    } catch {
      setError('Upload failed')
    } finally {
      setUploading(false)
    }
  }

  function submit() {
    if (teamName.trim().length < 1) { setError('Team name is required'); return }
    if (!favoriteTeamId) { setError('Please pick a favourite NHL team'); return }
    setError('')
    onSubmit({ teamName: teamName.trim(), teamIcon, favoriteTeamId })
  }

  const conferences = ['east', 'west']
  const divisions: Record<string, string[]> = {
    east: ['Atlantic', 'Metropolitan'],
    west: ['Central', 'Pacific'],
  }
  const filteredTeams = (conference: string, division: string) =>
    nhlTeams
      .filter(t => t.conference === conference && t.division === division)
      .filter(t => !search || t.city.toLowerCase().includes(search.toLowerCase()) || t.name.toLowerCase().includes(search.toLowerCase()))

  const selectedTeam = nhlTeams.find(t => t.id === favoriteTeamId)
  const iconIsUrl = teamIcon?.startsWith('https://') ?? false

  return (
    <div>
      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      <label className="block text-sm font-semibold mb-1">Team Name</label>
      <input
        className="w-full border-2 border-gray-200 rounded-xl p-3 mb-5 focus:border-orange-500 outline-none"
        placeholder="e.g. BobsTeam"
        value={teamName}
        onChange={e => setTeamName(e.target.value)}
        maxLength={30}
      />

      <label className="block text-sm font-semibold mb-2">Team Icon</label>
      <div className="grid grid-cols-5 gap-2 mb-2">
        {EMOJI_OPTIONS.map(e => (
          <button
            key={e}
            type="button"
            onClick={() => setTeamIcon(e)}
            className={`text-2xl p-2 rounded-xl border-2 transition ${teamIcon === e ? 'border-orange-500 bg-orange-50' : 'border-gray-200'}`}
          >
            {e}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        className="w-full py-2 mb-2 border-2 border-dashed border-gray-300 rounded-xl text-sm font-semibold text-gray-600 hover:border-orange-400 disabled:opacity-50"
      >
        {uploading ? 'Uploading…' : '📷 Upload Custom Icon'}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        onChange={handleFile}
        className="hidden"
      />
      {iconIsUrl && teamIcon && (
        <div className="flex items-center gap-2 mb-5 p-2 border border-gray-200 rounded-xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={teamIcon} alt="Team icon" className="w-10 h-10 rounded-full object-cover" />
          <span className="text-xs text-gray-500">Custom icon uploaded</span>
          <button type="button" onClick={() => setTeamIcon('🏒')} className="ml-auto text-xs text-red-500 font-bold">Remove</button>
        </div>
      )}

      <label className="block text-sm font-semibold mb-2 mt-4">Favourite NHL Team</label>
      <p className="text-xs text-gray-500 mb-3">Your league dashboard will use their colours.</p>
      <input
        className="w-full border-2 border-gray-200 rounded-xl p-2 text-sm mb-4 focus:border-orange-500 outline-none"
        placeholder="Search teams…"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      {conferences.map(conf => (
        <div key={conf} className="mb-4">
          <span className={`text-xs font-bold tracking-widest uppercase text-white px-2 py-0.5 rounded ${conf === 'east' ? 'bg-blue-900' : 'bg-green-800'}`}>
            {conf === 'east' ? 'Eastern' : 'Western'}
          </span>
          {divisions[conf].map(div => {
            const teams = filteredTeams(conf, div)
            if (!teams.length) return null
            return (
              <div key={div} className="mt-2">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">{div}</p>
                <div className="grid grid-cols-4 gap-2">
                  {teams.map(team => (
                    <button
                      key={team.id}
                      type="button"
                      onClick={() => setFavoriteTeamId(team.id)}
                      className={`rounded-xl border-2 p-2 text-center transition ${favoriteTeamId === team.id ? 'border-current' : 'border-gray-200'}`}
                      style={favoriteTeamId === team.id ? { borderColor: team.colorPrimary, backgroundColor: team.colorPrimary + '10' } : {}}
                    >
                      <div
                        className="w-6 h-6 rounded-full mx-auto mb-1"
                        style={{ background: `linear-gradient(135deg, ${team.colorPrimary}, ${team.colorSecondary})` }}
                      />
                      <p className="text-[10px] font-semibold leading-tight" style={favoriteTeamId === team.id ? { color: team.colorPrimary } : { color: '#444' }}>
                        {team.city}<br />{team.name}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      ))}

      <button
        type="button"
        onClick={submit}
        disabled={loading || uploading}
        className="w-full py-3 rounded-xl font-bold text-white transition disabled:opacity-40 mt-2"
        style={{ backgroundColor: selectedTeam?.colorPrimary ?? '#FF6B00' }}
      >
        {loading ? 'Saving…' : submitLabel}
      </button>
    </div>
  )
}
