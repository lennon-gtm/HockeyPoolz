/**
 * InjuryService — pulls the current NHL injury list from ESPN's public feed
 * and updates NhlPlayer.injuryStatus.
 *
 * ESPN is the data source because api-web.nhle.com has no public injuries
 * endpoint. Matching is name-based since ESPN uses its own athlete IDs.
 */
import { prisma } from '@/lib/prisma'
import type { InjuryStatus } from '@prisma/client'

const ESPN_NHL_INJURIES = 'https://site.web.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries'

interface EspnInjury {
  status?: string
  athlete?: { displayName?: string; firstName?: string; lastName?: string }
}
interface EspnTeamInjuries { injuries?: EspnInjury[] }
interface EspnPayload { injuries?: EspnTeamInjuries[] }

function mapStatus(raw: string | undefined): InjuryStatus | null {
  if (!raw) return null
  const s = raw.toLowerCase()
  if (s.includes('day')) return 'DTD'
  if (s.includes('injured reserve') || s.includes('long')) return 'LTIR'
  if (s === 'out' || s.includes('out')) return 'OUT'
  return null
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/\./g, '')              // strip periods (J.T. → jt)
    .replace(/-/g, ' ')              // hyphens → spaces
    .replace(/\s+(jr|sr|ii|iii|iv)\.?$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface InjurySyncResult {
  fetched: number
  matched: number
  cleared: number
  unmatched: string[]
  byStatus: Record<InjuryStatus, number>
}

export async function syncInjuries(): Promise<InjurySyncResult> {
  const res = await fetch(ESPN_NHL_INJURIES, { cache: 'no-store' })
  if (!res.ok) throw new Error(`ESPN injuries ${res.status}`)
  const data: EspnPayload = await res.json()

  // Flatten ESPN payload → { normalizedName, status } list.
  const espnEntries: { name: string; status: InjuryStatus }[] = []
  for (const team of data.injuries ?? []) {
    for (const inj of team.injuries ?? []) {
      const status = mapStatus(inj.status)
      const display = inj.athlete?.displayName
        ?? [inj.athlete?.firstName, inj.athlete?.lastName].filter(Boolean).join(' ')
      if (!status || !display) continue
      espnEntries.push({ name: normalizeName(display), status })
    }
  }

  // Load our playoff pool once; match in memory.
  const players = await prisma.nhlPlayer.findMany({
    where: { isActive: true, team: { playoffQualified: true } },
    select: { id: true, name: true, injuryStatus: true },
  })
  const byName = new Map<string, typeof players[number][]>()
  for (const p of players) {
    const key = normalizeName(p.name)
    const bucket = byName.get(key) ?? []
    bucket.push(p)
    byName.set(key, bucket)
  }

  const matched = new Map<number, InjuryStatus>() // playerId → status
  const unmatched: string[] = []
  for (const { name, status } of espnEntries) {
    const bucket = byName.get(name)
    // Only update if exactly one player matches this name — ambiguous matches
    // are rare but can exist (e.g. father/son) and we'd rather skip than
    // mis-tag a player.
    if (bucket?.length === 1) matched.set(bucket[0].id, status)
    else if (!bucket) unmatched.push(name)
  }

  const matchedIds = [...matched.keys()]

  // Clear status on anyone no longer in the ESPN list (recoveries).
  const cleared = await prisma.nhlPlayer.updateMany({
    where: {
      injuryStatus: { not: null },
      id: matchedIds.length > 0 ? { notIn: matchedIds } : undefined,
    },
    data: { injuryStatus: null },
  })

  // Apply/refresh status for matched players.
  for (const [playerId, status] of matched) {
    await prisma.nhlPlayer.update({
      where: { id: playerId },
      data: { injuryStatus: status },
    })
  }

  const byStatus: Record<InjuryStatus, number> = { DTD: 0, OUT: 0, LTIR: 0 }
  for (const s of matched.values()) byStatus[s]++

  return {
    fetched: espnEntries.length,
    matched: matched.size,
    cleared: cleared.count,
    unmatched,
    byStatus,
  }
}
