'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface Props {
  leagueId: string
  color: string
}

interface Tab {
  label: string
  slug: string
  match: (pathname: string) => boolean
}

export function LeagueNav({ leagueId, color }: Props) {
  const pathname = usePathname() ?? ''
  const base = `/league/${leagueId}`

  const tabs: Tab[] = [
    { label: 'LOBBY', slug: '', match: (p) => p === base || p === `${base}/` },
    { label: 'SCORES', slug: '/scores', match: (p) => p.startsWith(`${base}/scores`) },
    { label: 'MY TEAM', slug: '/team', match: (p) => p.startsWith(`${base}/team`) },
    { label: 'STANDINGS', slug: '/standings', match: (p) => p.startsWith(`${base}/standings`) },
    { label: 'DRAFT', slug: '/draft', match: (p) => p.startsWith(`${base}/draft`) },
  ]

  return (
    <nav className="bg-[#111] border-t border-[#252525] px-4 flex">
      {tabs.map(tab => {
        const active = tab.match(pathname)
        return (
          <Link
            key={tab.label}
            href={`${base}${tab.slug}`}
            className={`py-2.5 px-3 text-[10px] font-bold tracking-wider ${active ? 'text-white' : 'text-[#515151]'}`}
            style={active ? { borderBottom: `2px solid ${color}` } : undefined}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
