import { describe, it, expect } from 'vitest'
import { buildGameSummaryPrompt, findBenefactor } from '../../lib/scores-service'

describe('buildGameSummaryPrompt', () => {
  it('includes both team names and score', () => {
    const prompt = buildGameSummaryPrompt({
      awayTeam: 'DAL', homeTeam: 'COL',
      awayScore: 2, homeScore: 4,
      gameState: 'FINAL', seriesStatus: 'COL leads 2-1',
      articleHeadline: 'Makar scores twice in Avs win',
      articleExcerpt: 'Nathan MacKinnon added two assists.',
      benefactor: { teamName: 'BobsTeam', fpts: 14.2, topPlayers: ['Cale Makar: 2G 1A (12.4 pts)'] },
    })
    expect(prompt).toContain('DAL')
    expect(prompt).toContain('COL')
    expect(prompt).toContain('4')
    expect(prompt).toContain('2')
  })

  it('includes series status', () => {
    const prompt = buildGameSummaryPrompt({
      awayTeam: 'DAL', homeTeam: 'COL',
      awayScore: 2, homeScore: 4,
      gameState: 'FINAL', seriesStatus: 'COL leads 2-1',
      articleHeadline: 'Makar scores twice',
      articleExcerpt: 'Colorado wins.',
      benefactor: { teamName: 'BobsTeam', fpts: 14.2, topPlayers: [] },
    })
    expect(prompt).toContain('COL leads 2-1')
  })

  it('includes benefactor team name and fpts', () => {
    const prompt = buildGameSummaryPrompt({
      awayTeam: 'DAL', homeTeam: 'COL',
      awayScore: 2, homeScore: 4,
      gameState: 'FINAL', seriesStatus: null,
      articleHeadline: 'Avs win',
      articleExcerpt: 'Good game.',
      benefactor: { teamName: 'BobsTeam', fpts: 14.2, topPlayers: ['Makar: 12.4 pts'] },
    })
    expect(prompt).toContain('BobsTeam')
    expect(prompt).toContain('14.2')
  })

  it('handles null benefactor gracefully', () => {
    const prompt = buildGameSummaryPrompt({
      awayTeam: 'DAL', homeTeam: 'COL',
      awayScore: 2, homeScore: 4,
      gameState: 'FINAL', seriesStatus: null,
      articleHeadline: 'Avs win',
      articleExcerpt: 'Good game.',
      benefactor: null,
    })
    expect(prompt).toContain('DAL')
    expect(prompt).not.toContain('undefined')
  })
})

describe('findBenefactor', () => {
  it('returns member with highest total fpts for that game', () => {
    const memberScores = [
      { teamName: 'BobsTeam', fpts: 14.2, topPlayers: ['Makar: 12.4 pts'] },
      { teamName: 'PuckDaddyFC', fpts: 5.1, topPlayers: ['Rantanen: 5.1 pts'] },
    ]
    const result = findBenefactor(memberScores)
    expect(result?.teamName).toBe('BobsTeam')
    expect(result?.fpts).toBe(14.2)
  })

  it('returns null for empty array', () => {
    expect(findBenefactor([])).toBeNull()
  })

  it('returns null if all members scored 0', () => {
    const memberScores = [
      { teamName: 'BobsTeam', fpts: 0, topPlayers: [] },
    ]
    expect(findBenefactor(memberScores)).toBeNull()
  })
})
