import { describe, it, expect } from 'vitest'
import { NHL_TEAMS } from '@/lib/nhl-teams-data'

describe('NHL_TEAMS', () => {
  it('contains all 32 teams', () => {
    expect(NHL_TEAMS).toHaveLength(32)
  })

  it('every team has required fields', () => {
    for (const team of NHL_TEAMS) {
      expect(team.id).toBeTruthy()
      expect(team.name).toBeTruthy()
      expect(team.city).toBeTruthy()
      expect(team.colorPrimary).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(team.colorSecondary).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(['east', 'west']).toContain(team.conference)
      expect(team.division).toBeTruthy()
    }
  })

  it('each conference has exactly 16 teams', () => {
    const east = NHL_TEAMS.filter(t => t.conference === 'east')
    const west = NHL_TEAMS.filter(t => t.conference === 'west')
    expect(east).toHaveLength(16)
    expect(west).toHaveLength(16)
  })

  it('team IDs are unique', () => {
    const ids = NHL_TEAMS.map(t => t.id)
    expect(new Set(ids).size).toBe(32)
  })
})
