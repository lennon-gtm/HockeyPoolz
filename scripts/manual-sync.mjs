/**
 * manual-sync.mjs
 * Directly syncs today's and yesterday's playoff game stats and recalculates scores.
 * Bypasses the HTTP cron endpoint — runs against the DB directly.
 *
 * Usage: node scripts/manual-sync.mjs [YYYY-MM-DD]
 * (defaults to today if no date given)
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load .env.local
const envPath = resolve(__dirname, '../.env.local')
const envLines = readFileSync(envPath, 'utf8').split('\n')
for (const line of envLines) {
  const match = line.match(/^([^#=]+)=(.*)$/)
  if (match) {
    const key = match[1].trim()
    const val = match[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')
    process.env[key] = val
  }
}

const { PrismaClient } = await import('@prisma/client')
const { PrismaPg } = await import('@prisma/adapter-pg')
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

const NHL_API = 'https://api-web.nhle.com/v1'

// --- NHL API helpers ---

async function fetchCompletedPlayoffGames(date) {
  const res = await fetch(`${NHL_API}/score/${date}`)
  if (!res.ok) throw new Error(`NHL /score/${date} returned ${res.status}`)
  const data = await res.json()
  return (data.games ?? []).filter(g => g.gameType === 3 && g.gameState === 'OFF')
}

async function fetchBoxScore(gameId) {
  const res = await fetch(`${NHL_API}/gamecenter/${gameId}/boxscore`)
  if (!res.ok) throw new Error(`NHL boxscore/${gameId} returned ${res.status}`)
  const data = await res.json()

  const stats = data.playerByGameStats
  const skaters = []
  const goalies = []
  for (const side of ['awayTeam', 'homeTeam']) {
    const team = stats?.[side]
    if (!team) continue
    for (const group of ['forwards', 'defense']) {
      for (const p of team[group] ?? []) skaters.push(p)
    }
    for (const p of team.goalies ?? []) goalies.push(p)
  }
  return { skaters, goalies }
}

async function fetchOTAssists(gameId) {
  try {
    const res = await fetch(`${NHL_API}/gamecenter/${gameId}/play-by-play`)
    if (!res.ok) return new Map()
    const data = await res.json()
    const otAssists = new Map()
    for (const play of data.plays ?? []) {
      if (play.typeDescKey === 'goal' && play.periodDescriptor?.periodType === 'OT') {
        if (play.details?.assist1PlayerId) {
          const id = play.details.assist1PlayerId
          otAssists.set(id, (otAssists.get(id) ?? 0) + 1)
        }
        if (play.details?.assist2PlayerId) {
          const id = play.details.assist2PlayerId
          otAssists.set(id, (otAssists.get(id) ?? 0) + 1)
        }
      }
    }
    return otAssists
  } catch { return new Map() }
}

async function fetchPlayerGameLog(playerId, season = '20252026') {
  try {
    const res = await fetch(`${NHL_API}/player/${playerId}/game-log/${season}/3`)
    if (!res.ok) return []
    const data = await res.json()
    return data.gameLog ?? []
  } catch { return [] }
}

// --- Sync logic ---

async function syncGameStats(date) {
  console.log(`\nSyncing games for ${date}...`)
  const games = await fetchCompletedPlayoffGames(date)
  console.log(`  Found ${games.length} completed playoff game(s)`)

  const picks = await prisma.draftPick.findMany({
    where: { draft: { league: { status: 'active' } }, player: { team: { eliminatedAt: null } } },
    select: { playerId: true },
    distinct: ['playerId'],
  })
  const draftedPlayerIds = new Set(picks.map(p => p.playerId))
  console.log(`  ${draftedPlayerIds.size} drafted players to track`)

  let playersUpdated = 0
  const errors = []

  for (const game of games) {
    console.log(`  Processing game ${game.id} (${game.awayTeam?.abbrev} @ ${game.homeTeam?.abbrev})`)
    try {
      const [{ skaters, goalies }, otAssistMap] = await Promise.all([
        fetchBoxScore(game.id),
        fetchOTAssists(game.id),
      ])

      for (const s of skaters) {
        const otA = otAssistMap.get(s.playerId) ?? 0
        try {
          await prisma.playerGameStats.upsert({
            where: { playerId_gameId: { playerId: s.playerId, gameId: String(game.id) } },
            update: { goals: s.goals ?? 0, assists: s.assists ?? 0, plusMinus: s.plusMinus ?? 0,
              pim: s.pim ?? 0, shots: s.sog ?? 0, hits: s.hits ?? 0,
              blockedShots: s.blockedShots ?? 0, powerPlayGoals: s.powerPlayGoals ?? 0, overtimeAssists: otA },
            create: { playerId: s.playerId, gameId: String(game.id), gameDate: new Date(date),
              goals: s.goals ?? 0, assists: s.assists ?? 0, plusMinus: s.plusMinus ?? 0,
              pim: s.pim ?? 0, shots: s.sog ?? 0, hits: s.hits ?? 0,
              blockedShots: s.blockedShots ?? 0, powerPlayGoals: s.powerPlayGoals ?? 0, overtimeAssists: otA },
          })
          playersUpdated++
        } catch (err) {
          // Player not in DB — skip silently (not a drafted player)
        }
      }

      for (const g of goalies) {
        try {
          await prisma.playerGameStats.upsert({
            where: { playerId_gameId: { playerId: g.playerId, gameId: String(game.id) } },
            update: { goalieWins: g.decision === 'W' ? 1 : 0, goalieSaves: g.saves ?? 0,
              goalsAgainst: g.goalsAgainst ?? 0, shutouts: (g.goalsAgainst === 0 && g.starter) ? 1 : 0,
              savePct: g.savePctg ? Number(g.savePctg) : 0 },
            create: { playerId: g.playerId, gameId: String(game.id), gameDate: new Date(date),
              goalieWins: g.decision === 'W' ? 1 : 0, goalieSaves: g.saves ?? 0,
              goalsAgainst: g.goalsAgainst ?? 0, shutouts: (g.goalsAgainst === 0 && g.starter) ? 1 : 0,
              savePct: g.savePctg ? Number(g.savePctg) : 0 },
          })
          playersUpdated++
        } catch (err) {}
      }
    } catch (err) {
      errors.push(`Game ${game.id}: ${err}`)
      console.error(`  Error processing game ${game.id}:`, err)
    }
  }

  // Extended stats from game logs (drafted players only)
  console.log(`  Fetching extended stats for drafted players...`)
  for (const playerId of draftedPlayerIds) {
    try {
      const gameLog = await fetchPlayerGameLog(playerId)
      for (const entry of gameLog) {
        const existing = await prisma.playerGameStats.findUnique({
          where: { playerId_gameId: { playerId, gameId: String(entry.gameId) } },
        })
        if (existing) {
          await prisma.playerGameStats.update({
            where: { playerId_gameId: { playerId, gameId: String(entry.gameId) } },
            data: {
              powerPlayPoints: entry.powerPlayPoints ?? 0,
              shorthandedGoals: entry.shorthandedGoals ?? 0,
              shorthandedPoints: entry.shorthandedPoints ?? 0,
              gameWinningGoals: entry.gameWinningGoals ?? 0,
              overtimeGoals: entry.otGoals ?? 0,
              ...(entry.shutouts !== undefined ? { shutouts: entry.shutouts } : {}),
            },
          })
        }
      }
    } catch (err) {
      errors.push(`Game log for player ${playerId}: ${err}`)
    }
  }

  return { gamesProcessed: games.length, playersUpdated, errors }
}

function calculatePlayerScore(stats, weights) {
  return (
    stats.goals * weights.goals +
    stats.assists * weights.assists +
    stats.plusMinus * weights.plusMinus +
    stats.pim * weights.pim +
    stats.shots * weights.shots +
    stats.hits * weights.hits +
    stats.blockedShots * weights.blockedShots +
    stats.powerPlayGoals * weights.powerPlayGoals +
    stats.powerPlayPoints * weights.powerPlayPoints +
    (stats.powerPlayPoints - stats.powerPlayGoals) * weights.powerPlayAssists +
    stats.shorthandedGoals * weights.shorthandedGoals +
    stats.shorthandedPoints * weights.shorthandedPoints +
    (stats.shorthandedPoints - stats.shorthandedGoals) * weights.shorthandedAssists +
    stats.gameWinningGoals * weights.gameWinningGoals +
    stats.overtimeGoals * weights.overtimeGoals +
    stats.overtimeAssists * weights.overtimeAssists +
    stats.goalieWins * weights.goalieWins +
    stats.goalieSaves * weights.goalieSaves +
    stats.shutouts * weights.shutouts -
    stats.goalsAgainst * weights.goalsAgainst
  )
}

async function recalculateScores(leagueId) {
  const [settings, league] = await Promise.all([
    prisma.scoringSettings.findUnique({ where: { leagueId } }),
    prisma.league.findUnique({ where: { id: leagueId }, select: { connSmytheWinnerId: true } }),
  ])
  if (!settings) return

  const weights = {
    goals: Number(settings.goals), assists: Number(settings.assists),
    plusMinus: Number(settings.plusMinus), pim: Number(settings.pim),
    shots: Number(settings.shots), hits: Number(settings.hits),
    blockedShots: Number(settings.blockedShots), powerPlayGoals: Number(settings.powerPlayGoals),
    powerPlayPoints: Number(settings.powerPlayPoints), powerPlayAssists: Number(settings.powerPlayAssists),
    shorthandedGoals: Number(settings.shorthandedGoals),
    shorthandedPoints: Number(settings.shorthandedPoints), shorthandedAssists: Number(settings.shorthandedAssists),
    gameWinningGoals: Number(settings.gameWinningGoals), overtimeGoals: Number(settings.overtimeGoals),
    overtimeAssists: Number(settings.overtimeAssists), goalieWins: Number(settings.goalieWins),
    goalieSaves: Number(settings.goalieSaves), shutouts: Number(settings.shutouts),
    goalsAgainst: Number(settings.goalsAgainst),
  }

  const connSmytheBonus = Number(settings.connSmytheTrophy)
  const connSmytheWinnerId = league?.connSmytheWinnerId ?? null

  const members = await prisma.leagueMember.findMany({
    where: { leagueId },
    include: { draftPicks: { include: { player: { include: { team: { select: { eliminatedAt: true } } } } } } },
  })

  for (const member of members) {
    const allGameStats = []
    for (const pick of member.draftPicks) {
      const eliminatedAt = pick.player.team.eliminatedAt
      const gameStats = await prisma.playerGameStats.findMany({
        where: { playerId: pick.playerId, ...(eliminatedAt ? { gameDate: { lte: eliminatedAt } } : {}) },
      })
      for (const gs of gameStats) {
        allGameStats.push({
          goals: gs.goals, assists: gs.assists, plusMinus: gs.plusMinus,
          pim: gs.pim, shots: gs.shots, hits: gs.hits, blockedShots: gs.blockedShots,
          powerPlayGoals: gs.powerPlayGoals, powerPlayPoints: gs.powerPlayPoints,
          shorthandedGoals: gs.shorthandedGoals, shorthandedPoints: gs.shorthandedPoints,
          gameWinningGoals: gs.gameWinningGoals, overtimeGoals: gs.overtimeGoals,
          overtimeAssists: gs.overtimeAssists, goalieWins: gs.goalieWins,
          goalieSaves: gs.goalieSaves, shutouts: gs.shutouts, goalsAgainst: gs.goalsAgainst,
        })
      }
    }
    let totalScore = allGameStats.reduce((sum, gs) => sum + calculatePlayerScore(gs, weights), 0)
    if (connSmytheWinnerId && connSmytheBonus > 0) {
      if (member.draftPicks.some(p => p.playerId === connSmytheWinnerId)) totalScore += connSmytheBonus
    }
    await prisma.leagueMember.update({
      where: { id: member.id },
      data: { totalScore, scoreLastCalculatedAt: new Date() },
    })
  }
}

// --- Main ---

const targetDate = process.argv[2] || new Date().toISOString().split('T')[0]
const yesterday = new Date(targetDate)
yesterday.setUTCDate(yesterday.getUTCDate() - 1)
const yesterdayStr = yesterday.toISOString().split('T')[0]

console.log(`=== HockeyPoolz Manual Sync ===`)
console.log(`Target dates: ${yesterdayStr}, ${targetDate}`)

try {
  const r1 = await syncGameStats(yesterdayStr)
  const r2 = await syncGameStats(targetDate)

  console.log(`\nStats synced:`)
  console.log(`  ${yesterdayStr}: ${r1.gamesProcessed} games, ${r1.playersUpdated} players`)
  console.log(`  ${targetDate}: ${r2.gamesProcessed} games, ${r2.playersUpdated} players`)
  if (r1.errors.length || r2.errors.length) {
    console.log(`  Errors:`, [...r1.errors, ...r2.errors])
  }

  console.log(`\nRecalculating scores for active leagues...`)
  const activeLeagues = await prisma.league.findMany({ where: { status: 'active' }, select: { id: true, name: true } })
  console.log(`  Found ${activeLeagues.length} active league(s)`)
  for (const league of activeLeagues) {
    await recalculateScores(league.id)
    console.log(`  ✓ ${league.name}`)
  }

  console.log(`\n✅ Sync complete.`)
} catch (err) {
  console.error('Sync failed:', err)
} finally {
  await prisma.$disconnect()
}
