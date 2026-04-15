/**
 * StatsService — all NHL API integration and score calculation.
 * No other file should call the NHL API directly.
 */

import { prisma } from './prisma'

const NHL_API_BASE = 'https://api-web.nhle.com/v1'

// --- Types ---

export interface GameStats {
  goals: number
  assists: number
  plusMinus: number
  pim: number
  shots: number
  hits: number
  blockedShots: number
  powerPlayGoals: number
  powerPlayPoints: number
  shorthandedGoals: number
  shorthandedPoints: number
  gameWinningGoals: number
  overtimeGoals: number
  goalieWins: number
  goalieSaves: number
  shutouts: number
  goalsAgainst: number
}

export interface ScoringWeights {
  goals: number
  assists: number
  plusMinus: number
  pim: number
  shots: number
  hits: number
  blockedShots: number
  powerPlayGoals: number
  powerPlayPoints: number
  shorthandedGoals: number
  shorthandedPoints: number
  gameWinningGoals: number
  overtimeGoals: number
  goalieWins: number
  goalieSaves: number
  shutouts: number
  goalsAgainst: number
}

export interface SyncResult {
  gamesProcessed: number
  playersUpdated: number
  errors: string[]
}

// --- Pure scoring functions ---

/** Calculate the weighted score for a single player's single game. */
export function calculatePlayerScore(stats: GameStats, weights: ScoringWeights): number {
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
    stats.shorthandedGoals * weights.shorthandedGoals +
    stats.shorthandedPoints * weights.shorthandedPoints +
    stats.gameWinningGoals * weights.gameWinningGoals +
    stats.overtimeGoals * weights.overtimeGoals +
    stats.goalieWins * weights.goalieWins +
    stats.goalieSaves * weights.goalieSaves +
    stats.shutouts * weights.shutouts -
    stats.goalsAgainst * weights.goalsAgainst
  )
}

/** Sum weighted scores across all game stat rows for a member's roster. */
export function calculateMemberScore(games: GameStats[], weights: ScoringWeights): number {
  return games.reduce((total, game) => total + calculatePlayerScore(game, weights), 0)
}

// --- NHL API fetch functions ---

interface NhlGameSummary {
  id: number
  gameType: number
  gameState: string
  awayTeam: { abbrev: string; score: number }
  homeTeam: { abbrev: string; score: number }
}

interface NhlBoxScorePlayer {
  playerId: number
  goals: number
  assists: number
  plusMinus: number
  pim: number
  sog: number
  hits: number
  blockedShots: number
  powerPlayGoals: number
  decision?: string
  saves?: number
  goalsAgainst?: number
  savePctg?: number
  starter?: boolean
}

interface NhlGameLogEntry {
  gameId: number
  gameDate: string
  goals: number
  assists: number
  plusMinus: number
  pim: number
  shots: number
  powerPlayGoals: number
  powerPlayPoints: number
  shorthandedGoals: number
  shorthandedPoints: number
  gameWinningGoals: number
  otGoals: number
  shotsAgainst?: number
  goalsAgainst?: number
  shutouts?: number
  decision?: string
}

/** Fetch completed playoff games for a given date. */
export async function fetchCompletedPlayoffGames(date: string): Promise<NhlGameSummary[]> {
  const res = await fetch(`${NHL_API_BASE}/score/${date}`)
  if (!res.ok) throw new Error(`NHL API /score/${date} returned ${res.status}`)
  const data = await res.json()
  return (data.games ?? []).filter(
    (g: NhlGameSummary) => g.gameType === 3 && g.gameState === 'OFF'
  )
}

/** Fetch box score for a single game. Returns all players with their stats. */
export async function fetchBoxScore(gameId: number): Promise<{
  skaters: NhlBoxScorePlayer[]
  goalies: NhlBoxScorePlayer[]
}> {
  const res = await fetch(`${NHL_API_BASE}/gamecenter/${gameId}/boxscore`)
  if (!res.ok) throw new Error(`NHL API boxscore/${gameId} returned ${res.status}`)
  const data = await res.json()

  const stats = data.playerByGameStats
  const skaters: NhlBoxScorePlayer[] = []
  const goalies: NhlBoxScorePlayer[] = []

  for (const side of ['awayTeam', 'homeTeam']) {
    const team = stats?.[side]
    if (!team) continue
    for (const group of ['forwards', 'defense']) {
      for (const p of team[group] ?? []) {
        skaters.push(p)
      }
    }
    for (const p of team.goalies ?? []) {
      goalies.push(p)
    }
  }

  return { skaters, goalies }
}

/** Fetch a player's playoff game log for extended stats. */
export async function fetchPlayerGameLog(playerId: number, season: string = '20252026'): Promise<NhlGameLogEntry[]> {
  const res = await fetch(`${NHL_API_BASE}/player/${playerId}/game-log/${season}/3`)
  if (!res.ok) throw new Error(`NHL API game-log/${playerId} returned ${res.status}`)
  const data = await res.json()
  return data.gameLog ?? []
}

/** Fetch playoff bracket to detect eliminated teams. */
export async function fetchPlayoffBracket(year: number = 2026): Promise<{ losingTeamId: number; losingTeamAbbrev: string }[]> {
  const res = await fetch(`${NHL_API_BASE}/playoff-bracket/${year}`)
  if (!res.ok) throw new Error(`NHL API playoff-bracket/${year} returned ${res.status}`)
  const data = await res.json()

  const eliminated: { losingTeamId: number; losingTeamAbbrev: string }[] = []
  for (const series of data.series ?? []) {
    if (series.losingTeamId) {
      const loser = series.topSeedTeam?.id === series.losingTeamId
        ? series.topSeedTeam
        : series.bottomSeedTeam
      eliminated.push({
        losingTeamId: series.losingTeamId,
        losingTeamAbbrev: loser?.abbrev ?? 'UNK',
      })
    }
  }
  return eliminated
}

/** Fetch current roster for a team. */
export async function fetchTeamRoster(teamAbbrev: string): Promise<{
  id: number; firstName: string; lastName: string; positionCode: string; headshot: string
}[]> {
  const res = await fetch(`${NHL_API_BASE}/roster/${teamAbbrev}/current`)
  if (!res.ok) throw new Error(`NHL API roster/${teamAbbrev} returned ${res.status}`)
  const data = await res.json()

  const players: { id: number; firstName: string; lastName: string; positionCode: string; headshot: string }[] = []
  for (const group of ['forwards', 'defensemen', 'goalies']) {
    for (const p of data[group] ?? []) {
      players.push({
        id: p.id,
        firstName: p.firstName?.default ?? p.firstName ?? '',
        lastName: p.lastName?.default ?? p.lastName ?? '',
        positionCode: p.positionCode,
        headshot: p.headshot ?? '',
      })
    }
  }
  return players
}

// --- Database sync functions ---

/** Map NHL API position code to Prisma Position enum. */
function mapPosition(code: string): 'C' | 'LW' | 'RW' | 'D' | 'G' {
  const map: Record<string, 'C' | 'LW' | 'RW' | 'D' | 'G'> = {
    C: 'C', L: 'LW', R: 'RW', D: 'D', G: 'G',
  }
  return map[code] ?? 'C'
}

/** Sync rosters for all non-eliminated teams. */
export async function syncRosters(): Promise<{ teamsUpdated: number; playersUpserted: number }> {
  const teams = await prisma.nhlTeam.findMany({
    where: { eliminatedAt: null },
    select: { id: true, abbreviation: true },
  })

  let playersUpserted = 0
  for (const team of teams) {
    try {
      const roster = await fetchTeamRoster(team.abbreviation)
      for (const p of roster) {
        await prisma.nhlPlayer.upsert({
          where: { id: p.id },
          update: {
            name: `${p.firstName} ${p.lastName}`,
            position: mapPosition(p.positionCode),
            headshotUrl: p.headshot || null,
            teamId: team.id,
            isActive: true,
          },
          create: {
            id: p.id,
            teamId: team.id,
            name: `${p.firstName} ${p.lastName}`,
            position: mapPosition(p.positionCode),
            headshotUrl: p.headshot || null,
            isActive: true,
          },
        })
        playersUpserted++
      }
    } catch (err) {
      console.error(`Failed to sync roster for ${team.abbreviation}:`, err)
    }
  }

  return { teamsUpdated: teams.length, playersUpserted }
}

/** Get all drafted player IDs across active leagues, excluding eliminated teams. */
async function getDraftedPlayerIds(): Promise<Set<number>> {
  const picks = await prisma.draftPick.findMany({
    where: {
      draft: { league: { status: 'active' } },
      player: { team: { eliminatedAt: null } },
    },
    select: { playerId: true },
    distinct: ['playerId'],
  })
  return new Set(picks.map(p => p.playerId))
}

/** Sync game stats for a given date. */
export async function syncGameStats(date: string): Promise<SyncResult> {
  const result: SyncResult = { gamesProcessed: 0, playersUpdated: 0, errors: [] }

  let games: NhlGameSummary[]
  try {
    games = await fetchCompletedPlayoffGames(date)
  } catch (err) {
    result.errors.push(`Failed to fetch games for ${date}: ${err}`)
    return result
  }

  const draftedPlayerIds = await getDraftedPlayerIds()

  for (const game of games) {
    try {
      const { skaters, goalies } = await fetchBoxScore(game.id)

      // Upsert skater stats from box score
      for (const s of skaters) {
        await prisma.playerGameStats.upsert({
          where: { playerId_gameId: { playerId: s.playerId, gameId: String(game.id) } },
          update: {
            goals: s.goals ?? 0,
            assists: s.assists ?? 0,
            plusMinus: s.plusMinus ?? 0,
            pim: s.pim ?? 0,
            shots: s.sog ?? 0,
            hits: s.hits ?? 0,
            blockedShots: s.blockedShots ?? 0,
            powerPlayGoals: s.powerPlayGoals ?? 0,
          },
          create: {
            playerId: s.playerId,
            gameId: String(game.id),
            gameDate: new Date(date),
            goals: s.goals ?? 0,
            assists: s.assists ?? 0,
            plusMinus: s.plusMinus ?? 0,
            pim: s.pim ?? 0,
            shots: s.sog ?? 0,
            hits: s.hits ?? 0,
            blockedShots: s.blockedShots ?? 0,
            powerPlayGoals: s.powerPlayGoals ?? 0,
          },
        })
        result.playersUpdated++
      }

      // Upsert goalie stats from box score
      for (const g of goalies) {
        await prisma.playerGameStats.upsert({
          where: { playerId_gameId: { playerId: g.playerId, gameId: String(game.id) } },
          update: {
            goalieWins: g.decision === 'W' ? 1 : 0,
            goalieSaves: g.saves ?? 0,
            goalsAgainst: g.goalsAgainst ?? 0,
            shutouts: (g.goalsAgainst === 0 && g.starter) ? 1 : 0,
            savePct: g.savePctg ? Number(g.savePctg) : 0,
          },
          create: {
            playerId: g.playerId,
            gameId: String(game.id),
            gameDate: new Date(date),
            goalieWins: g.decision === 'W' ? 1 : 0,
            goalieSaves: g.saves ?? 0,
            goalsAgainst: g.goalsAgainst ?? 0,
            shutouts: (g.goalsAgainst === 0 && g.starter) ? 1 : 0,
            savePct: g.savePctg ? Number(g.savePctg) : 0,
          },
        })
        result.playersUpdated++
      }

      result.gamesProcessed++
    } catch (err) {
      result.errors.push(`Failed to process game ${game.id}: ${err}`)
    }
  }

  // Fetch extended stats from player game logs for drafted players only
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
      result.errors.push(`Failed to fetch game log for player ${playerId}: ${err}`)
    }
  }

  return result
}

/** Check the playoff bracket and mark eliminated teams. */
export async function checkEliminations(): Promise<string[]> {
  const bracket = await fetchPlayoffBracket()
  const newlyEliminated: string[] = []

  for (const entry of bracket) {
    const team = await prisma.nhlTeam.findFirst({
      where: {
        abbreviation: entry.losingTeamAbbrev,
        eliminatedAt: null,
      },
    })
    if (team) {
      await prisma.nhlTeam.update({
        where: { id: team.id },
        data: { eliminatedAt: new Date() },
      })
      newlyEliminated.push(team.abbreviation)
    }
  }

  return newlyEliminated
}

/**
 * For a given league and date string ('YYYY-MM-DD'), sum each member's
 * drafted players' game stats for that date and upsert one MemberDailyScore row
 * per member. Returns the number of rows upserted.
 */
export async function writeMemberDailyScores(leagueId: string, date: string): Promise<number> {
  const settings = await prisma.scoringSettings.findUnique({ where: { leagueId } })
  if (!settings) return 0

  const weights: ScoringWeights = {
    goals: Number(settings.goals),
    assists: Number(settings.assists),
    plusMinus: Number(settings.plusMinus),
    pim: Number(settings.pim),
    shots: Number(settings.shots),
    hits: Number(settings.hits),
    blockedShots: Number(settings.blockedShots),
    powerPlayGoals: Number(settings.powerPlayGoals),
    powerPlayPoints: Number(settings.powerPlayPoints),
    shorthandedGoals: Number(settings.shorthandedGoals),
    shorthandedPoints: Number(settings.shorthandedPoints),
    gameWinningGoals: Number(settings.gameWinningGoals),
    overtimeGoals: Number(settings.overtimeGoals),
    goalieWins: Number(settings.goalieWins),
    goalieSaves: Number(settings.goalieSaves),
    shutouts: Number(settings.shutouts),
    goalsAgainst: Number(settings.goalsAgainst),
  }

  const [year, month, day] = (date as string).split('-').map(Number)
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
    const dayStats: GameStats[] = []

    for (const pick of member.draftPicks) {
      const eliminatedAt = pick.player.team.eliminatedAt
      // Skip players whose team was eliminated before this game date
      if (eliminatedAt && eliminatedAt < gameDate) continue

      for (const gs of pick.player.gameStats) {
        dayStats.push({
          goals: gs.goals,
          assists: gs.assists,
          plusMinus: gs.plusMinus,
          pim: gs.pim,
          shots: gs.shots,
          hits: gs.hits,
          blockedShots: gs.blockedShots,
          powerPlayGoals: gs.powerPlayGoals,
          powerPlayPoints: gs.powerPlayPoints,
          shorthandedGoals: gs.shorthandedGoals,
          shorthandedPoints: gs.shorthandedPoints,
          gameWinningGoals: gs.gameWinningGoals,
          overtimeGoals: gs.overtimeGoals,
          goalieWins: gs.goalieWins,
          goalieSaves: gs.goalieSaves,
          shutouts: gs.shutouts,
          goalsAgainst: gs.goalsAgainst,
        })
      }
    }

    const fpts = calculateMemberScore(dayStats, weights)
    await prisma.memberDailyScore.upsert({
      where: { memberId_gameDate: { memberId: member.id, gameDate } },
      update: { fpts },
      create: { memberId: member.id, gameDate, fpts },
    })
    written++
  }

  return written
}

/** Recalculate scores for all members in a league. */
export async function recalculateScores(leagueId: string): Promise<void> {
  const settings = await prisma.scoringSettings.findUnique({ where: { leagueId } })
  if (!settings) return

  const weights: ScoringWeights = {
    goals: Number(settings.goals),
    assists: Number(settings.assists),
    plusMinus: Number(settings.plusMinus),
    pim: Number(settings.pim),
    shots: Number(settings.shots),
    hits: Number(settings.hits),
    blockedShots: Number(settings.blockedShots),
    powerPlayGoals: Number(settings.powerPlayGoals),
    powerPlayPoints: Number(settings.powerPlayPoints),
    shorthandedGoals: Number(settings.shorthandedGoals),
    shorthandedPoints: Number(settings.shorthandedPoints),
    gameWinningGoals: Number(settings.gameWinningGoals),
    overtimeGoals: Number(settings.overtimeGoals),
    goalieWins: Number(settings.goalieWins),
    goalieSaves: Number(settings.goalieSaves),
    shutouts: Number(settings.shutouts),
    goalsAgainst: Number(settings.goalsAgainst),
  }

  const members = await prisma.leagueMember.findMany({
    where: { leagueId },
    include: {
      draftPicks: {
        include: {
          player: {
            include: { team: { select: { eliminatedAt: true } } },
          },
        },
      },
    },
  })

  for (const member of members) {
    const allGameStats: GameStats[] = []

    for (const pick of member.draftPicks) {
      const eliminatedAt = pick.player.team.eliminatedAt
      const gameStats = await prisma.playerGameStats.findMany({
        where: {
          playerId: pick.playerId,
          ...(eliminatedAt ? { gameDate: { lte: eliminatedAt } } : {}),
        },
      })

      for (const gs of gameStats) {
        allGameStats.push({
          goals: gs.goals,
          assists: gs.assists,
          plusMinus: gs.plusMinus,
          pim: gs.pim,
          shots: gs.shots,
          hits: gs.hits,
          blockedShots: gs.blockedShots,
          powerPlayGoals: gs.powerPlayGoals,
          powerPlayPoints: gs.powerPlayPoints,
          shorthandedGoals: gs.shorthandedGoals,
          shorthandedPoints: gs.shorthandedPoints,
          gameWinningGoals: gs.gameWinningGoals,
          overtimeGoals: gs.overtimeGoals,
          goalieWins: gs.goalieWins,
          goalieSaves: gs.goalieSaves,
          shutouts: gs.shutouts,
          goalsAgainst: gs.goalsAgainst,
        })
      }
    }

    const totalScore = calculateMemberScore(allGameStats, weights)

    await prisma.leagueMember.update({
      where: { id: member.id },
      data: {
        totalScore,
        scoreLastCalculatedAt: new Date(),
      },
    })
  }
}
