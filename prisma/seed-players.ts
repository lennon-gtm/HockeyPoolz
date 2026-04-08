import { config } from 'dotenv'
config({ path: '.env.local' })

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

const TEAMS = ['EDM', 'COL', 'DAL', 'VGK', 'NSH', 'MIN', 'STL', 'LAK',
               'FLA', 'TBL', 'BOS', 'NYR', 'PIT', 'WSH', 'CAR', 'TOR']

const NHL_API = 'https://api-web.nhle.com/v1'

type PosCode = 'C' | 'L' | 'R' | 'D' | 'G'
const posMap: Record<PosCode, 'C' | 'LW' | 'RW' | 'D' | 'G'> = {
  C: 'C', L: 'LW', R: 'RW', D: 'D', G: 'G',
}

interface ApiPlayer {
  id: number
  firstName: { default: string }
  lastName: { default: string }
  positionCode: PosCode
  headshot: string
}

async function fetchRoster(team: string): Promise<ApiPlayer[]> {
  try {
    const res = await fetch(`${NHL_API}/roster/${team}/current`)
    if (!res.ok) { console.warn(`Roster fetch failed for ${team}: ${res.status}`); return [] }
    const data = await res.json() as { forwards?: ApiPlayer[]; defensemen?: ApiPlayer[]; goalies?: ApiPlayer[] }
    return [...(data.forwards ?? []), ...(data.defensemen ?? []), ...(data.goalies ?? [])]
  } catch (err) {
    console.warn(`Roster fetch error for ${team}:`, err)
    return []
  }
}

async function main() {
  console.log('Seeding NHL players...')
  let adpCounter = 1

  for (const team of TEAMS) {
    const players = await fetchRoster(team)
    console.log(`${team}: ${players.length} players`)

    for (const p of players) {
      const position = posMap[p.positionCode] ?? 'C'
      const adp = adpCounter

      await prisma.nhlPlayer.upsert({
        where: { id: p.id },
        update: {
          teamId: team,
          name: `${p.firstName.default} ${p.lastName.default}`,
          position,
          headshotUrl: p.headshot || null,
          adp,
          isActive: true,
        },
        create: {
          id: p.id,
          teamId: team,
          name: `${p.firstName.default} ${p.lastName.default}`,
          position,
          headshotUrl: p.headshot || null,
          adp,
          isActive: true,
        },
      })
      adpCounter++
    }
  }

  const count = await prisma.nhlPlayer.count()
  console.log(`Done. Total players in DB: ${count}`)
  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
