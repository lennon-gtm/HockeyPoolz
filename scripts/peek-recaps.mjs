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

const since = new Date('2026-04-28')
const recaps = await prisma.leagueRecap.findMany({
  where: { recapDate: { gte: since } },
  include: { league: { select: { name: true } } },
  orderBy: [{ league: { name: 'asc' } }, { recapDate: 'asc' }],
})

for (const r of recaps) {
  const d = r.recapDate.toISOString().slice(0, 10)
  const preview = r.content.slice(0, 80).replace(/\n/g, ' ')
  console.log(`${d}  ${r.league.name.padEnd(28)}  ${preview}${r.content.length > 80 ? '…' : ''}`)
}
await prisma.$disconnect()
