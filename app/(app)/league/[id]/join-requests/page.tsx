'use client'
import { useState, useEffect, use, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { auth } from '@/lib/firebase/client'
import { TeamIcon } from '@/components/team-icon'

interface PendingRequest {
  id: string
  teamName: string
  teamIcon: string | null
  submittedAt: string
  user: { id: string; email: string; displayName: string; avatarUrl: string | null }
  favoriteTeam: { id: string; name: string; colorPrimary: string; colorSecondary: string } | null
}

export default function JoinRequestsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [requests, setRequests] = useState<PendingRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [approving, setApproving] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const token = await auth.currentUser?.getIdToken()
    if (!token) return
    const res = await fetch(`/api/leagues/${id}/join-requests`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.status === 403) { setError('Commissioner only'); setLoading(false); return }
    if (!res.ok) { setError('Failed to load requests'); setLoading(false); return }
    const data = await res.json()
    setRequests(data.requests ?? [])
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  async function approve(requestId: string) {
    setApproving(requestId)
    setError('')
    try {
      const token = await auth.currentUser?.getIdToken()
      if (!token) { setError('Not signed in'); return }
      const res = await fetch(`/api/leagues/${id}/join-requests`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Failed to approve')
        return
      }
      await load()
    } finally { setApproving(null) }
  }

  return (
    <div className="bg-white min-h-screen">
      <div className="p-4 max-w-xl mx-auto">
        <button onClick={() => router.back()} className="text-xs text-[#98989e] mb-3 font-semibold hover:text-[#515151]">
          ← Back
        </button>
        <h1 className="text-xl font-black tracking-tight text-[#121212] mb-1">Join Requests</h1>
        <p className="text-xs text-[#98989e] font-semibold mb-6">
          Review and approve new league members
        </p>
        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
        {loading && <p className="text-sm text-[#98989e]">Loading…</p>}
        {!loading && requests.length === 0 && !error && (
          <p className="text-sm text-[#98989e]">No pending requests.</p>
        )}
        {requests.map(req => (
          <div key={req.id} className="border-b border-[#f5f5f5] py-3 flex items-center gap-3">
            <TeamIcon icon={req.teamIcon} size="lg" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-[#121212] truncate">{req.teamName}</p>
              <p className="text-xs text-[#98989e] truncate">{req.user.displayName} · {req.user.email}</p>
              {req.favoriteTeam && (
                <p className="text-[10px] text-[#98989e] mt-0.5">Fan of {req.favoriteTeam.name}</p>
              )}
            </div>
            <button
              onClick={() => approve(req.id)}
              disabled={approving === req.id}
              className="px-3 py-1.5 text-xs font-bold bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 transition"
            >
              {approving === req.id ? 'Approving…' : 'Approve'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
