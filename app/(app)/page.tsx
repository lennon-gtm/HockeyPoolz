'use client'
import { useState, useEffect } from 'react'
import { auth } from '@/lib/firebase/client'
import Link from 'next/link'

interface League { id: string; name: string; status: string; members: { id: string }[] }

export default function HomePage() {
  const [leagues, setLeagues] = useState<League[]>([])

  useEffect(() => {
    async function load() {
      const token = await auth.currentUser?.getIdToken()
      if (!token) return
      const res = await fetch('/api/leagues', { headers: { Authorization: `Bearer ${token}` } })
      const data = await res.json()
      setLeagues(data.leagues ?? [])
    }
    load()
  }, [])

  return (
    <div className="min-h-screen bg-white p-6 max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-black tracking-widest">HOCKEYPOOLZ</h1>
        <Link href="/league/create" className="bg-orange-500 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-orange-600 transition">
          + Create League
        </Link>
      </div>
      {leagues.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-4xl mb-3">🏒</p>
          <p className="font-semibold">No leagues yet</p>
          <p className="text-sm mt-1">Create one or ask a friend for an invite link</p>
        </div>
      ) : (
        leagues.map(league => (
          <Link key={league.id} href={`/league/${league.id}`}
            className="block border-2 border-gray-100 rounded-xl p-4 mb-3 hover:border-orange-300 transition">
            <p className="font-bold">{league.name}</p>
            <p className="text-sm text-gray-500">{league.members.length} members · {league.status}</p>
          </Link>
        ))
      )}
    </div>
  )
}
