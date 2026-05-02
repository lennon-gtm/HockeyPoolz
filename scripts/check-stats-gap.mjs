/**
 * Read-only diagnostic. Counts PlayerGameStats rows per gameDate
 * and MemberDailyScore rows per gameDate for the recent window,
 * to identify days where the cron sync was incomplete.
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'

const envPath = resolve(process.cwd(), '.env.production.local')
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) {
    const key = m[1].trim()
    const val = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')
    process.env[key] = val
  }
}
process.env.DATABASE_URL = process.env.DIRECT_URL || process.env.DATABASE_URL

const { PrismaClient } = await import('@prisma/client')
const { PrismaPg } = await import('@prisma/adapter-pg')
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

const since = new Date('2026-04-25')

const pgs = await prisma.playerGameStats.groupBy({
  by: ['gameDate'],
  where: { gameDate: { gte: since } },
  _count: { _all: true },
  orderBy: { gameDate: 'asc' },
})
console.log('\nPlayerGameStats rows by gameDate (since 2026-04-25):')
for (const r of pgs) {
  const d = r.gameDate.toISOString().slice(0, 10)
  const distinctGames = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT "gameId")::int AS c
    FROM "PlayerGameStats"
    WHERE "gameDate" = ${r.gameDate}
  `
  const games = distinctGames[0]?.c ?? 0
  console.log(`  ${d}  rows=${r._count._all}  distinctGames=${games}`)
}

const mds = await prisma.memberDailyScore.groupBy({
  by: ['gameDate'],
  where: { gameDate: { gte: since } },
  _count: { _all: true },
  orderBy: { gameDate: 'asc' },
})
console.log('\nMemberDailyScore rows by gameDate (since 2026-04-25):')
for (const r of mds) {
  const d = r.gameDate.toISOString().slice(0, 10)
  console.log(`  ${d}  rows=${r._count._all}`)
}

const activeLeagues = await prisma.league.findMany({
  where: { status: 'active' },
  select: { id: true, name: true, _count: { select: { members: true } } },
})
console.log(`\nActive leagues: ${activeLeagues.length}`)
for (const l of activeLeagues) {
  console.log(`  ${l.name}  members=${l._count.members}  id=${l.id.slice(0,8)}`)
}

console.log('\nNHL schedule for 2026-04-29 (live check):')
try {
  const res = await fetch('https://api-web.nhle.com/v1/schedule/2026-04-29', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; HockeyPoolz/1.0)',
      Accept: 'application/json',
    },
  })
  if (res.ok) {
    const data = await res.json()
    const day = (data.gameWeek ?? []).find(d => d.date === '2026-04-29')
    const games = (day?.games ?? []).filter(g => g.gameType === 3)
    console.log(`  NHL reports ${games.length} playoff game(s) for 2026-04-29:`)
    for (const g of games) {
      console.log(`    ${g.id}  ${g.awayTeam?.abbrev} @ ${g.homeTeam?.abbrev}  state=${g.gameState}`)
    }
  } else {
    console.log(`  fetch failed: ${res.status}`)
  }
} catch (e) {
  console.log(`  fetch error: ${e.message}`)
}

await prisma.$disconnect()
