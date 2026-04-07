'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { auth } from '@/lib/firebase/client'

interface NhlTeam {
  id: string; name: string; city: string
  conference: string; division: string
  colorPrimary: string; colorSecondary: string
}

type Step = 'team-name' | 'team-icon' | 'nhl-team'

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('team-name')
  const [teamName, setTeamName] = useState('')
  const [teamIcon, setTeamIcon] = useState('🏒')
  const [selectedTeamId, setSelectedTeamId] = useState('')
  const [nhlTeams, setNhlTeams] = useState<NhlTeam[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const EMOJI_OPTIONS = ['🏒', '🦅', '🐺', '⚡', '🔥', '🦁', '🦊', '🐻', '🏆', '🥅']

  useEffect(() => {
    fetch('/api/nhl-teams').then(r => r.json()).then(d => setNhlTeams(d.teams))
  }, [])

  const conferences = ['east', 'west']
  const divisions: Record<string, string[]> = {
    east: ['Atlantic', 'Metropolitan'],
    west: ['Central', 'Pacific'],
  }

  const filteredTeams = (conference: string, division: string) =>
    nhlTeams
      .filter(t => t.conference === conference && t.division === division)
      .filter(t => !search || t.city.toLowerCase().includes(search.toLowerCase()) || t.name.toLowerCase().includes(search.toLowerCase()))

  async function complete() {
    if (!selectedTeamId) { setError('Please select a team'); return }
    setLoading(true)
    try {
      const token = await auth.currentUser?.getIdToken()
      if (!token) { setError('Not signed in. Please reload and try again.'); return }
      const res = await fetch('/api/auth/me', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ favoriteTeamId: selectedTeamId, displayName: teamName, avatarUrl: teamIcon }),
      })
      if (!res.ok) { setError('Something went wrong. Please try again.'); return }
      router.push('/')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const selectedTeam = nhlTeams.find(t => t.id === selectedTeamId)

  return (
    <div className="min-h-screen bg-white">
      <div
        className="p-5 transition-colors duration-300"
        style={{ backgroundColor: selectedTeam?.colorPrimary ?? '#FF6B00' }}
      >
        <p className="text-white font-black tracking-widest text-lg">HOCKEYPOOLZ</p>
        <p className="text-white/70 text-xs mt-1">
          {step === 'team-name' && 'Step 1 of 3 — Name your team'}
          {step === 'team-icon' && 'Step 2 of 3 — Choose an icon'}
          {step === 'nhl-team' && 'Step 3 of 3 — Pick your favourite NHL team'}
        </p>
        {selectedTeam && (
          <p className="text-white/90 text-sm font-semibold mt-2">✓ {selectedTeam.city} {selectedTeam.name}</p>
        )}
      </div>

      <div className="p-6 max-w-lg mx-auto">
        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

        {step === 'team-name' && (
          <>
            <h2 className="text-xl font-bold mb-1">Name your team</h2>
            <p className="text-gray-500 text-sm mb-6">This is how you&apos;ll appear in the league standings.</p>
            <input
              className="w-full border-2 border-gray-200 rounded-xl p-3 text-base focus:border-orange-500 outline-none mb-6"
              placeholder="e.g. BobsTeam"
              value={teamName}
              onChange={e => setTeamName(e.target.value)}
              maxLength={30}
            />
            <button
              onClick={() => { if (teamName.trim().length >= 1) { setError(''); setStep('team-icon') } else setError('Enter a team name') }}
              className="w-full py-3 rounded-xl font-bold text-white bg-orange-500 hover:bg-orange-600 transition"
            >
              Next →
            </button>
          </>
        )}

        {step === 'team-icon' && (
          <>
            <h2 className="text-xl font-bold mb-1">Choose a team icon</h2>
            <p className="text-gray-500 text-sm mb-6">Shows up next to your team name everywhere.</p>
            <div className="grid grid-cols-5 gap-3 mb-6">
              {EMOJI_OPTIONS.map(e => (
                <button
                  key={e}
                  onClick={() => setTeamIcon(e)}
                  className={`text-3xl p-3 rounded-xl border-2 transition ${teamIcon === e ? 'border-orange-500 bg-orange-50' : 'border-gray-200'}`}
                >
                  {e}
                </button>
              ))}
            </div>
            <button
              onClick={() => setStep('nhl-team')}
              className="w-full py-3 rounded-xl font-bold text-white bg-orange-500 hover:bg-orange-600 transition"
            >
              Next →
            </button>
          </>
        )}

        {step === 'nhl-team' && (
          <>
            <h2 className="text-xl font-bold mb-1">Pick your favourite NHL team</h2>
            <p className="text-gray-500 text-sm mb-4">Your dashboard will match their colours all playoff long.</p>
            <input
              className="w-full border-2 border-gray-200 rounded-xl p-3 text-sm focus:border-orange-500 outline-none mb-5"
              placeholder="Search teams…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {conferences.map(conf => (
              <div key={conf} className="mb-5">
                <span className={`text-xs font-bold tracking-widest uppercase text-white px-3 py-1 rounded-md ${conf === 'east' ? 'bg-blue-900' : 'bg-green-800'}`}>
                  {conf === 'east' ? 'Eastern' : 'Western'} Conference
                </span>
                {divisions[conf].map(div => {
                  const teams = filteredTeams(conf, div)
                  if (!teams.length) return null
                  return (
                    <div key={div} className="mt-3">
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 border-l-2 border-gray-200 pl-2">{div} Division</p>
                      <div className="grid grid-cols-4 gap-2">
                        {teams.map(team => (
                          <button
                            key={team.id}
                            onClick={() => setSelectedTeamId(team.id)}
                            className={`rounded-xl border-2 p-2 text-center transition ${selectedTeamId === team.id ? 'border-current' : 'border-gray-200'}`}
                            style={selectedTeamId === team.id ? { borderColor: team.colorPrimary, backgroundColor: team.colorPrimary + '10' } : {}}
                          >
                            <div
                              className="w-8 h-8 rounded-full mx-auto mb-1"
                              style={{ background: `linear-gradient(135deg, ${team.colorPrimary}, ${team.colorSecondary})` }}
                            />
                            <p className="text-xs font-semibold leading-tight" style={selectedTeamId === team.id ? { color: team.colorPrimary } : { color: '#444' }}>
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
              onClick={complete}
              disabled={loading || !selectedTeamId}
              className="w-full py-3 rounded-xl font-bold text-white transition disabled:opacity-40 mt-4"
              style={{ backgroundColor: selectedTeam?.colorPrimary ?? '#FF6B00' }}
            >
              {loading ? 'Saving…' : 'Enter My League →'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
