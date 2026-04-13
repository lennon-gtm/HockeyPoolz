/**
 * StatsService — all NHL API integration and score calculation.
 * No other file should call the NHL API directly.
 */

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
