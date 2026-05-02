/**
 * Read-only snapshot of LeagueMember.totalScore + per-day MemberDailyScore.fpts
 * across active leagues. Run before & after a reconciliation to confirm changes.
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

const leagues = await prisma.league.findMany({
  where: { status: 'active' },
  select: {
    id: true, name: true,
    members: {
      select: {
        id: true, totalScore: true,
        user: { select: { displayName: true, email: true } },
      },
      orderBy: { totalScore: 'desc' },
    },
  },
})

for (const l of leagues) {
  console.log(`\n=== ${l.name} (${l.id.slice(0,8)}) ===`)
  for (const m of l.members) {
    const who = m.user?.displayName || m.user?.email || m.id.slice(0,8)
    console.log(`  ${String(m.totalScore).padStart(8)}  ${who}`)
  }
}

console.log(`\n--- MemberDailyScore totals by date (since 2026-04-25) ---`)
const since = new Date('2026-04-25T00:00:00Z')
const mds = await prisma.memberDailyScore.groupBy({
  by: ['gameDate'],
  where: { gameDate: { gte: since } },
  _sum: { fpts: true },
  _count: { _all: true },
  orderBy: { gameDate: 'asc' },
})
for (const r of mds) {
  const d = r.gameDate.toISOString().slice(0, 10)
  console.log(`  ${d}  members=${r._count._all}  total fpts=${r._sum.fpts ?? 0}`)
}

await prisma.$disconnect()
