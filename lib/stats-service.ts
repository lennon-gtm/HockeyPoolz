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
