/**
 * Read-only diagnostic for a single player. Shows per-game stats in our DB
 * AND fetches the same player's game log from NHL to compare.
 *
 * Usage: node scripts/check-player.mjs <playerId>
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

const playerId = Number(process.argv[2])
if (!playerId) { console.error('Usage: node scripts/check-player.mjs <playerId>'); process.exit(1) }

const player = await prisma.nhlPlayer.findUnique({
  where: { id: playerId },
  include: { team: { select: { abbreviation: true, name: true } } },
})
console.log(`\nPlayer ${playerId}: ${player?.name ?? '(unknown)'}  team=${player?.team?.abbreviation ?? '?'}`)

const dbStats = await prisma.playerGameStats.findMany({
  where: { playerId },
  orderBy: { gameDate: 'asc' },
})

console.log(`\n--- DB rows: ${dbStats.length} ---`)
console.log('date        gameId      G  A  +/-  S  H  BLK  PPG  PPP  SHG  SHP  GWG  OTG  OTA  goalieW  saves  GA  SO')
for (const s of dbStats) {
  const d = s.gameDate.toISOString().slice(0, 10)
  console.log(
    `${d}  ${s.gameId.padEnd(10)}  ${s.goals}  ${s.assists}  ${String(s.plusMinus).padStart(3)}  ${s.shots}  ${s.hits}  ${String(s.blockedShots).padStart(3)}` +
    `  ${String(s.powerPlayGoals).padStart(3)}  ${String(s.powerPlayPoints).padStart(3)}  ${String(s.shorthandedGoals).padStart(3)}  ${String(s.shorthandedPoints).padStart(3)}` +
    `  ${String(s.gameWinningGoals).padStart(3)}  ${String(s.overtimeGoals).padStart(3)}  ${String(s.overtimeAssists).padStart(3)}` +
    `  ${String(s.goalieWins).padStart(7)}  ${String(s.goalieSaves).padStart(5)}  ${String(s.goalsAgainst).padStart(2)}  ${s.shutouts}`
  )
}

// Compare to NHL game log
console.log(`\n--- NHL game log (playoffs season 20252026) ---`)
const res = await fetch(`https://api-web.nhle.com/v1/player/${playerId}/game-log/20252026/3`, {
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; HockeyPoolz/1.0)',
    Accept: 'application/json',
  },
})
if (!res.ok) {
  console.log(`  fetch failed: ${res.status}`)
} else {
  const data = await res.json()
  const log = data.gameLog ?? []
  console.log(`  NHL reports ${log.length} game(s)`)
  console.log('date        gameId      G  A  +/-  S  PPG  PPP  SHG  SHP  GWG  OTG')
  for (const g of log) {
    console.log(
      `${g.gameDate}  ${String(g.gameId).padEnd(10)}  ${g.goals ?? 0}  ${g.assists ?? 0}  ${String(g.plusMinus ?? 0).padStart(3)}  ${g.shots ?? 0}` +
      `  ${String(g.powerPlayGoals ?? 0).padStart(3)}  ${String(g.powerPlayPoints ?? 0).padStart(3)}` +
      `  ${String(g.shorthandedGoals ?? 0).padStart(3)}  ${String(g.shorthandedPoints ?? 0).padStart(3)}` +
      `  ${String(g.gameWinningGoals ?? 0).padStart(3)}  ${String(g.otGoals ?? 0).padStart(3)}`
    )
  }
}

await prisma.$disconnect()
