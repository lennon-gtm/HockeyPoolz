import { describe, it, expect } from 'vitest'
import { buildRecapPrompt, buildLeagueRecapPrompt, buildDraftDayPrompt } from '../../lib/recap-service'

describe('buildRecapPrompt', () => {
  const standings = [
    { rank: 1, teamName: 'Puck Buddies', userName: 'Lennon', totalScore: 85.5 },
    { rank: 2, teamName: 'Ice Breakers', userName: 'Jordan', totalScore: 72.0 },
    { rank: 3, teamName: 'Goal Diggers', userName: 'Alex', totalScore: 60.0 },
  ]

  const memberPlayerStats = [
    { name: 'Connor McDavid', opponent: 'VAN', goals: 2, assists: 1, plusMinus: 2, weightedScore: 8.5 },
    { name: 'Leon Draisaitl', opponent: 'VAN', goals: 0, assists: 2, plusMinus: 1, weightedScore: 3.7 },
  ]

  const topLeaguePlayers = [
    { name: 'Auston Matthews', ownerTeam: 'Ice Breakers', goals: 3, assists: 0, weightedScore: 7.5 },
    { name: 'Nathan MacKinnon', ownerTeam: 'Goal Diggers', goals: 1, assists: 2, weightedScore: 5.0 },
  ]

  it('includes member team name and rank', () => {
    const prompt = buildRecapPrompt({
      teamName: 'Puck Buddies',
      currentRank: 1,
      standingChange: 2,
      memberPlayerStats,
      standings,
      topLeaguePlayers,
    })
    expect(prompt).toContain('Puck Buddies')
    expect(prompt).toContain('1st')
    expect(prompt).toContain('+2')
  })

  it('includes player stats for the member', () => {
    const prompt = buildRecapPrompt({
      teamName: 'Puck Buddies',
      currentRank: 1,
      standingChange: 0,
      memberPlayerStats,
      standings,
      topLeaguePlayers,
    })
    expect(prompt).toContain('Connor McDavid')
    expect(prompt).toContain('Leon Draisaitl')
    expect(prompt).toContain('8.5')
  })

  it('includes full standings', () => {
    const prompt = buildRecapPrompt({
      teamName: 'Puck Buddies',
      currentRank: 1,
      standingChange: 0,
      memberPlayerStats,
      standings,
      topLeaguePlayers,
    })
    expect(prompt).toContain('Ice Breakers')
    expect(prompt).toContain('72.0')
  })

  it('includes top league players for trash talk', () => {
    const prompt = buildRecapPrompt({
      teamName: 'Puck Buddies',
      currentRank: 1,
      standingChange: 0,
      memberPlayerStats,
      standings,
      topLeaguePlayers,
    })
    expect(prompt).toContain('Auston Matthews')
    expect(prompt).toContain('Ice Breakers')
  })

  it('handles negative standing change', () => {
    const prompt = buildRecapPrompt({
      teamName: 'Goal Diggers',
      currentRank: 3,
      standingChange: -1,
      memberPlayerStats: [],
      standings,
      topLeaguePlayers: [],
    })
    expect(prompt).toContain('-1')
  })
})

describe('buildLeagueRecapPrompt', () => {
  const dailyScores = [
    { teamName: 'GrindersUnited', fpts: 18.4 },
    { teamName: 'BobsTeam', fpts: 14.2 },
    { teamName: 'IceQueenFC', fpts: 1.8 },
  ]
  const standings = [
    { rank: 1, teamName: 'GrindersUnited', userName: 'mike', totalScore: 222.6 },
    { rank: 2, teamName: 'BobsTeam', userName: 'bob', totalScore: 218.4 },
    { rank: 3, teamName: 'IceQueenFC', userName: 'sarah', totalScore: 190.0 },
  ]

  it('includes all team names from daily scores', () => {
    const prompt = buildLeagueRecapPrompt({ leagueName: 'Champs Pool', dailyScores, standings })
    expect(prompt).toContain('GrindersUnited')
    expect(prompt).toContain('BobsTeam')
    expect(prompt).toContain('IceQueenFC')
  })

  it('includes fpts values', () => {
    const prompt = buildLeagueRecapPrompt({ leagueName: 'Champs Pool', dailyScores, standings })
    expect(prompt).toContain('18.4')
    expect(prompt).toContain('1.8')
  })

  it('includes current standings', () => {
    const prompt = buildLeagueRecapPrompt({ leagueName: 'Champs Pool', dailyScores, standings })
    expect(prompt).toContain('222.6')
    expect(prompt).toContain('218.4')
  })

  it('includes league name', () => {
    const prompt = buildLeagueRecapPrompt({ leagueName: 'Champs Pool', dailyScores, standings })
    expect(prompt).toContain('Champs Pool')
  })
})

describe('buildDraftDayPrompt', () => {
  it('includes all team names', () => {
    const prompt = buildDraftDayPrompt({
      leagueName: 'Champs Pool',
      teams: ['GrindersUnited', 'IceQueenFC', 'BobsTeam'],
    })
    expect(prompt).toContain('GrindersUnited')
    expect(prompt).toContain('IceQueenFC')
    expect(prompt).toContain('BobsTeam')
  })

  it('includes league name', () => {
    const prompt = buildDraftDayPrompt({ leagueName: 'Champs Pool', teams: ['A', 'B'] })
    expect(prompt).toContain('Champs Pool')
  })

  it('numbers teams in order', () => {
    const prompt = buildDraftDayPrompt({ leagueName: 'Test', teams: ['Alpha', 'Beta', 'Gamma'] })
    expect(prompt).toContain('1.')
    expect(prompt).toContain('2.')
    expect(prompt).toContain('3.')
  })
})
