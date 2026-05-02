/**
 * manual-sync.mjs
 *
 * Reconciles NHL playoff game stats for one date or a date range, then
 * recalculates league scores and (re)writes MemberDailyScore rows. Mirrors
 * the production cron at app/api/cron/sync-stats/route.ts so output is
 * identical to what the cron would have produced if it had run cleanly.
 *
 * Usage:
 *   node scripts/manual-sync.mjs                       # reconciles today only
 *   node scripts/manual-sync.mjs 2026-04-29            # reconciles single date
 *   node scripts/manual-sync.mjs 2026-04-29 2026-05-02 # reconciles inclusive range
 *
 * Reads DB credentials from .env.production.local (DIRECT_URL preferred).
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

// --- Env loading ---

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

// --- NHL API ---

const NHL_API = 'https://api-web.nhle.com/v1'
const NHL_FETCH_INIT = {
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; HockeyPoolz/1.0; +https://hockey-poolz.vercel.app)',
    Accept: 'application/json',
  },
}

async function fetchCompletedPlayoffGames(date) {
  const res = await fetch(`${NHL_API}/schedule/${date}`, NHL_FETCH_INIT)
  if (!res.ok) throw new Error(`NHL /schedule/${date} returned ${res.status}`)
  const data = await res.json()
  const day = (data.gameWeek ?? []).find(d => d.date === date)
  return (day?.games ?? []).filter(g => g.gameType === 3 && g.gameState === 'OFF')
}

async function fetchBoxScore(gameId) {
  const res = await fetch(`${NHL_API}/gamecenter/${gameId}/boxscore`, NHL_FETCH_INIT)
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
    const res = await fetch(`${NHL_API}/gamecenter/${gameId}/play-by-play`, NHL_FETCH_INIT)
    if (!res.ok) return new Map()
    const data = await res.json()
    const m = new Map()
    for (const play of data.plays ?? []) {
      if (play.typeDescKey === 'goal' && play.periodDescriptor?.periodType === 'OT') {
        for (const k of ['assist1PlayerId', 'assist2PlayerId']) {
          const id = play.details?.[k]
          if (id) m.set(id, (m.get(id) ?? 0) + 1)
        }
      }
    }
    return m
  } catch { return new Map() }
}

async function fetchPlayerGameLog(playerId, season = '20252026') {
  try {
    const res = await fetch(`${NHL_API}/player/${playerId}/game-log/${season}/3`, NHL_FETCH_INIT)
    if (!res.ok) return []
    const data = await res.json()
    return data.gameLog ?? []
  } catch { return [] }
}

// --- Sync (mirrors lib/stats-service.ts:syncGameStats) ---

async function getDraftedPlayerIds() {
  const picks = await prisma.draftPick.findMany({
    where: { draft: { league: { status: 'active' } }, player: { team: { eliminatedAt: null } } },
    select: { playerId: true },
    distinct: ['playerId'],
  })
  return new Set(picks.map(p => p.playerId))
}

async function syncGameStats(date) {
  console.log(`\n[${date}] Syncing playoff games...`)
  let games
  try {
    games = await fetchCompletedPlayoffGames(date)
  } catch (err) {
    console.error(`  Failed to fetch schedule: ${err.message}`)
    return { gamesProcessed: 0, playersUpdated: 0, errors: [err.message] }
  }
  console.log(`  Found ${games.length} completed playoff game(s)`)

  const draftedPlayerIds = await getDraftedPlayerIds()
  const playedPlayerIds = new Set()
  const syncedGameIds = new Set()
  const result = { gamesProcessed: 0, playersUpdated: 0, errors: [] }

  for (const game of games) {
    const tag = `${game.awayTeam?.abbrev} @ ${game.homeTeam?.abbrev}`
    try {
      const [{ skaters, goalies }, otAssistMap] = await Promise.all([
        fetchBoxScore(game.id),
        fetchOTAssists(game.id),
      ])

      for (const s of skaters) {
        const otA = otAssistMap.get(s.playerId) ?? 0
        await prisma.playerGameStats.upsert({
          where: { playerId_gameId: { playerId: s.playerId, gameId: String(game.id) } },
          update: {
            goals: s.goals ?? 0, assists: s.assists ?? 0, plusMinus: s.plusMinus ?? 0,
            pim: s.pim ?? 0, shots: s.sog ?? 0, hits: s.hits ?? 0,
            blockedShots: s.blockedShots ?? 0, powerPlayGoals: s.powerPlayGoals ?? 0,
            overtimeAssists: otA,
          },
          create: {
            playerId: s.playerId, gameId: String(game.id), gameDate: new Date(date),
            goals: s.goals ?? 0, assists: s.assists ?? 0, plusMinus: s.plusMinus ?? 0,
            pim: s.pim ?? 0, shots: s.sog ?? 0, hits: s.hits ?? 0,
            blockedShots: s.blockedShots ?? 0, powerPlayGoals: s.powerPlayGoals ?? 0,
            overtimeAssists: otA,
          },
        })
        playedPlayerIds.add(s.playerId)
        result.playersUpdated++
      }

      for (const g of goalies) {
        await prisma.playerGameStats.upsert({
          where: { playerId_gameId: { playerId: g.playerId, gameId: String(game.id) } },
          update: {
            goalieWins: g.decision === 'W' ? 1 : 0, goalieSaves: g.saves ?? 0,
            goalsAgainst: g.goalsAgainst ?? 0,
            shutouts: (g.goalsAgainst === 0 && g.starter) ? 1 : 0,
            savePct: g.savePctg ? Number(g.savePctg) : 0,
          },
          create: {
            playerId: g.playerId, gameId: String(game.id), gameDate: new Date(date),
            goalieWins: g.decision === 'W' ? 1 : 0, goalieSaves: g.saves ?? 0,
            goalsAgainst: g.goalsAgainst ?? 0,
            shutouts: (g.goalsAgainst === 0 && g.starter) ? 1 : 0,
            savePct: g.savePctg ? Number(g.savePctg) : 0,
          },
        })
        playedPlayerIds.add(g.playerId)
        result.playersUpdated++
      }

      syncedGameIds.add(String(game.id))
      result.gamesProcessed++
      console.log(`  ✓ ${game.id} ${tag}`)
    } catch (err) {
      result.errors.push(`Game ${game.id}: ${err.message}`)
      console.error(`  ✗ ${game.id} ${tag}: ${err.message}`)
    }
  }

  // Extended stats — only for drafted players who actually played in synced games
  const targets = []
  for (const pid of playedPlayerIds) if (draftedPlayerIds.has(pid)) targets.push(pid)
  console.log(`  Fetching extended stats for ${targets.length} drafted player(s) who played...`)

  let extendedFilled = 0
  for (const playerId of targets) {
    try {
      const gameLog = await fetchPlayerGameLog(playerId)
      for (const entry of gameLog) {
        const gid = String(entry.gameId)
        if (!syncedGameIds.has(gid)) continue
        await prisma.playerGameStats.update({
          where: { playerId_gameId: { playerId, gameId: gid } },
          data: {
            powerPlayPoints: entry.powerPlayPoints ?? 0,
            shorthandedGoals: entry.shorthandedGoals ?? 0,
            shorthandedPoints: entry.shorthandedPoints ?? 0,
            gameWinningGoals: entry.gameWinningGoals ?? 0,
            overtimeGoals: entry.otGoals ?? 0,
            ...(entry.shutouts !== undefined ? { shutouts: entry.shutouts } : {}),
          },
        })
        extendedFilled++
      }
      await new Promise(r => setTimeout(r, 150))  // pace ourselves vs NHL rate limit
    } catch (err) {
      result.errors.push(`Game log for player ${playerId}: ${err.message}`)
    }
  }
  console.log(`  Filled extended stats on ${extendedFilled} player-game row(s)`)

  return result
}

// --- Scoring ---

const WEIGHT_KEYS = [
  'goals','assists','plusMinus','pim','shots','hits','blockedShots',
  'powerPlayGoals','powerPlayPoints','powerPlayAssists','shorthandedGoals',
  'shorthandedPoints','shorthandedAssists','gameWinningGoals','overtimeGoals',
  'overtimeAssists','goalieWins','goalieSaves','shutouts','goalsAgainst',
]

function weightsFromSettings(settings) {
  const w = {}
  for (const k of WEIGHT_KEYS) w[k] = Number(settings[k])
  return w
}

function statsFromRow(gs) {
  return {
    goals: gs.goals, assists: gs.assists, plusMinus: gs.plusMinus,
    pim: gs.pim, shots: gs.shots, hits: gs.hits, blockedShots: gs.blockedShots,
    powerPlayGoals: gs.powerPlayGoals, powerPlayPoints: gs.powerPlayPoints,
    powerPlayAssists: gs.powerPlayPoints - gs.powerPlayGoals,
    shorthandedGoals: gs.shorthandedGoals, shorthandedPoints: gs.shorthandedPoints,
    shorthandedAssists: gs.shorthandedPoints - gs.shorthandedGoals,
    gameWinningGoals: gs.gameWinningGoals, overtimeGoals: gs.overtimeGoals,
    overtimeAssists: gs.overtimeAssists, goalieWins: gs.goalieWins,
    goalieSaves: gs.goalieSaves, shutouts: gs.shutouts, goalsAgainst: gs.goalsAgainst,
  }
}

function scoreOneGame(s, w) {
  return (
    s.goals * w.goals + s.assists * w.assists + s.plusMinus * w.plusMinus +
    s.pim * w.pim + s.shots * w.shots + s.hits * w.hits +
    s.blockedShots * w.blockedShots + s.powerPlayGoals * w.powerPlayGoals +
    s.powerPlayPoints * w.powerPlayPoints + s.powerPlayAssists * w.powerPlayAssists +
    s.shorthandedGoals * w.shorthandedGoals + s.shorthandedPoints * w.shorthandedPoints +
    s.shorthandedAssists * w.shorthandedAssists + s.gameWinningGoals * w.gameWinningGoals +
    s.overtimeGoals * w.overtimeGoals + s.overtimeAssists * w.overtimeAssists +
    s.goalieWins * w.goalieWins + s.goalieSaves * w.goalieSaves +
    s.shutouts * w.shutouts - s.goalsAgainst * w.goalsAgainst
  )
}

async function recalculateScores(leagueId) {
  const [settings, league] = await Promise.all([
    prisma.scoringSettings.findUnique({ where: { leagueId } }),
    prisma.league.findUnique({ where: { id: leagueId }, select: { connSmytheWinnerId: true } }),
  ])
  if (!settings) return
  const weights = weightsFromSettings(settings)
  const connSmytheBonus = Number(settings.connSmytheTrophy)
  const connSmytheWinnerId = league?.connSmytheWinnerId ?? null

  const members = await prisma.leagueMember.findMany({
    where: { leagueId },
    include: { draftPicks: { include: { player: { include: { team: { select: { eliminatedAt: true } } } } } } },
  })

  for (const member of members) {
    let totalScore = 0
    for (const pick of member.draftPicks) {
      const eliminatedAt = pick.player.team.eliminatedAt
      const gameStats = await prisma.playerGameStats.findMany({
        where: {
          playerId: pick.playerId,
          // Exclude regular-season backfill rows (gameId prefix "rs-").
          // Playoff rows are stored with the raw NHL gameId (no prefix).
          NOT: { gameId: { startsWith: 'rs-' } },
          ...(eliminatedAt ? { gameDate: { lte: eliminatedAt } } : {}),
        },
      })
      for (const gs of gameStats) totalScore += scoreOneGame(statsFromRow(gs), weights)
    }
    if (connSmytheWinnerId && connSmytheBonus > 0
        && member.draftPicks.some(p => p.playerId === connSmytheWinnerId)) {
      totalScore += connSmytheBonus
    }
    await prisma.leagueMember.update({
      where: { id: member.id },
      data: { totalScore, scoreLastCalculatedAt: new Date() },
    })
  }
}

async function writeMemberDailyScores(leagueId, date) {
  const settings = await prisma.scoringSettings.findUnique({ where: { leagueId } })
  if (!settings) return 0
  const weights = weightsFromSettings(settings)

  const [year, month, day] = date.split('-').map(Number)
  const gameDate = new Date(Date.UTC(year, month - 1, day))

  const members = await prisma.leagueMember.findMany({
    where: { leagueId },
    include: {
      draftPicks: {
        include: {
          player: {
            include: {
              team: { select: { eliminatedAt: true } },
              gameStats: { where: { gameDate } },
            },
          },
        },
      },
    },
  })

  let written = 0
  for (const member of members) {
    let fpts = 0
    for (const pick of member.draftPicks) {
      const eliminatedAt = pick.player.team.eliminatedAt
      if (eliminatedAt && eliminatedAt < gameDate) continue
      for (const gs of pick.player.gameStats) {
        fpts += scoreOneGame(statsFromRow(gs), weights)
      }
    }
    await prisma.memberDailyScore.upsert({
      where: { memberId_gameDate: { memberId: member.id, gameDate } },
      update: { fpts },
      create: { memberId: member.id, gameDate, fpts },
    })
    written++
  }
  return written
}

// --- Date helpers ---

function todayUTC() {
  return new Date().toISOString().split('T')[0]
}

function expandDateRange(from, to) {
  const out = []
  const start = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)
  for (let d = start; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().split('T')[0])
  }
  return out
}

// --- Main ---

const argFrom = process.argv[2] ?? todayUTC()
const argTo = process.argv[3] ?? argFrom
const dates = expandDateRange(argFrom, argTo)
const today = todayUTC()

console.log(`=== HockeyPoolz Reconciliation ===`)
console.log(`Date range: ${dates[0]} → ${dates[dates.length - 1]}  (${dates.length} day(s))`)

try {
  const summaries = []
  for (const date of dates) {
    const r = await syncGameStats(date)
    summaries.push({ date, ...r })
  }

  console.log(`\n--- Stat sync summary ---`)
  for (const s of summaries) {
    console.log(`  ${s.date}: ${s.gamesProcessed} games, ${s.playersUpdated} player upserts, ${s.errors.length} error(s)`)
    for (const e of s.errors) console.log(`     ! ${e}`)
  }

  const activeLeagues = await prisma.league.findMany({
    where: { status: 'active' },
    select: { id: true, name: true },
  })
  console.log(`\nRecalculating totals for ${activeLeagues.length} active league(s)...`)
  for (const l of activeLeagues) {
    await recalculateScores(l.id)
    console.log(`  ✓ ${l.name}`)
  }

  console.log(`\nWriting MemberDailyScore rows (skipping today=${today})...`)
  for (const l of activeLeagues) {
    for (const date of dates) {
      if (date === today) continue   // today's not done yet; cron writes it tomorrow
      const n = await writeMemberDailyScores(l.id, date)
      console.log(`  ${l.name} ${date}: ${n} member-day rows`)
    }
  }

  console.log(`\n✅ Reconciliation complete.`)
} catch (err) {
  console.error('Reconciliation failed:', err)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
