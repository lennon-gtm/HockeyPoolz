import { describe, it, expect } from 'vitest'
import { calculatePlayerScore, calculateMemberScore } from '../../lib/stats-service'

const DEFAULT_WEIGHTS = {
  goals: 2.0, assists: 1.5, plusMinus: 0.5, pim: 0.0, shots: 0.1,
  hits: 0.0, blockedShots: 0.0, powerPlayGoals: 0.5, powerPlayPoints: 0.0,
  shorthandedGoals: 0.0, shorthandedPoints: 0.0, gameWinningGoals: 1.0,
  overtimeGoals: 1.0, goalieWins: 3.0, goalieSaves: 0.2, shutouts: 5.0,
  goalsAgainst: 0.0,
}

describe('calculatePlayerScore', () => {
  it('calculates weighted score for a skater game', () => {
    const gameStats = {
      goals: 2, assists: 1, plusMinus: 1, pim: 2, shots: 5,
      hits: 3, blockedShots: 1, powerPlayGoals: 1, powerPlayPoints: 1,
      shorthandedGoals: 0, shorthandedPoints: 0, gameWinningGoals: 1,
      overtimeGoals: 0, goalieWins: 0, goalieSaves: 0, shutouts: 0,
      goalsAgainst: 0,
    }
    const score = calculatePlayerScore(gameStats, DEFAULT_WEIGHTS)
    // goals: 2*2.0=4.0, assists: 1*1.5=1.5, plusMinus: 1*0.5=0.5,
    // pim: 2*0.0=0, shots: 5*0.1=0.5, ppGoals: 1*0.5=0.5, gwg: 1*1.0=1.0
    expect(score).toBeCloseTo(8.0)
  })

  it('calculates weighted score for a goalie game', () => {
    const gameStats = {
      goals: 0, assists: 0, plusMinus: 0, pim: 0, shots: 0,
      hits: 0, blockedShots: 0, powerPlayGoals: 0, powerPlayPoints: 0,
      shorthandedGoals: 0, shorthandedPoints: 0, gameWinningGoals: 0,
      overtimeGoals: 0, goalieWins: 1, goalieSaves: 30, shutouts: 1,
      goalsAgainst: 0,
    }
    const score = calculatePlayerScore(gameStats, DEFAULT_WEIGHTS)
    // wins: 1*3.0=3.0, saves: 30*0.2=6.0, shutouts: 1*5.0=5.0
    expect(score).toBeCloseTo(14.0)
  })

  it('subtracts goalsAgainst when weight is set', () => {
    const gameStats = {
      goals: 0, assists: 0, plusMinus: 0, pim: 0, shots: 0,
      hits: 0, blockedShots: 0, powerPlayGoals: 0, powerPlayPoints: 0,
      shorthandedGoals: 0, shorthandedPoints: 0, gameWinningGoals: 0,
      overtimeGoals: 0, goalieWins: 1, goalieSaves: 25, shutouts: 0,
      goalsAgainst: 3,
    }
    const weights = { ...DEFAULT_WEIGHTS, goalsAgainst: 1.0 }
    const score = calculatePlayerScore(gameStats, weights)
    // wins: 3.0, saves: 5.0, goalsAgainst: -3*1.0=-3.0
    expect(score).toBeCloseTo(5.0)
  })

  it('returns zero when all weights are zero', () => {
    const gameStats = {
      goals: 5, assists: 3, plusMinus: 2, pim: 4, shots: 10,
      hits: 5, blockedShots: 2, powerPlayGoals: 2, powerPlayPoints: 3,
      shorthandedGoals: 1, shorthandedPoints: 1, gameWinningGoals: 1,
      overtimeGoals: 1, goalieWins: 0, goalieSaves: 0, shutouts: 0,
      goalsAgainst: 0,
    }
    const zeroWeights = Object.fromEntries(
      Object.keys(DEFAULT_WEIGHTS).map(k => [k, 0])
    ) as typeof DEFAULT_WEIGHTS
    expect(calculatePlayerScore(gameStats, zeroWeights)).toBe(0)
  })
})

describe('calculateMemberScore', () => {
  it('sums scores across multiple games for multiple players', () => {
    const playerGames = [
      { goals: 1, assists: 0, plusMinus: 0, pim: 0, shots: 3,
        hits: 0, blockedShots: 0, powerPlayGoals: 0, powerPlayPoints: 0,
        shorthandedGoals: 0, shorthandedPoints: 0, gameWinningGoals: 0,
        overtimeGoals: 0, goalieWins: 0, goalieSaves: 0, shutouts: 0,
        goalsAgainst: 0 },
      { goals: 0, assists: 2, plusMinus: 1, pim: 0, shots: 2,
        hits: 0, blockedShots: 0, powerPlayGoals: 0, powerPlayPoints: 0,
        shorthandedGoals: 0, shorthandedPoints: 0, gameWinningGoals: 0,
        overtimeGoals: 0, goalieWins: 0, goalieSaves: 0, shutouts: 0,
        goalsAgainst: 0 },
    ]
    const total = calculateMemberScore(playerGames, DEFAULT_WEIGHTS)
    // Game 1: 1*2.0 + 3*0.1 = 2.3
    // Game 2: 2*1.5 + 1*0.5 + 2*0.1 = 3.7
    expect(total).toBeCloseTo(6.0)
  })

  it('returns zero for empty game list', () => {
    expect(calculateMemberScore([], DEFAULT_WEIGHTS)).toBe(0)
  })
})
