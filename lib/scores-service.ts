/**
 * ScoresService — NHL game results, benefactor calculation, AI callout generation.
 */

import Anthropic from '@anthropic-ai/sdk'
import { prisma } from './prisma'
import { calculatePlayerScore, type ScoringWeights } from './stats-service'

// --- Types ---

export interface GameSummaryPromptInput {
  awayTeam: string
  homeTeam: string
  awayScore: number
  homeScore: number
  gameState: string
  seriesStatus: string | null
  articleHeadline: string
  articleExcerpt: string
  benefactor: BenefactorEntry | null
}

export interface BenefactorEntry {
  teamName: string
  fpts: number
  topPlayers: string[]   // e.g. ["Cale Makar: 2G 1A (12.4 pts)"]
}

export interface MemberGameScore {
  teamName: string
  fpts: number
  topPlayers: string[]
}

// --- Pure functions ---

/** Find the league member who scored the most from a single game. Returns null if no one scored. */
export function findBenefactor(memberScores: MemberGameScore[]): BenefactorEntry | null {
  if (memberScores.length === 0) return null
  const best = memberScores.reduce((a, b) => b.fpts > a.fpts ? b : a)
  if (best.fpts <= 0) return null
  return best
}

/** Build the per-game Claude prompt. */
export function buildGameSummaryPrompt(input: GameSummaryPromptInput): string {
  const { awayTeam, homeTeam, awayScore, homeScore, gameState, seriesStatus, articleHeadline, articleExcerpt, benefactor } = input

  const scoreLine = `${awayTeam} ${awayScore} @ ${homeTeam} ${homeScore} (${gameState}${seriesStatus ? ` — ${seriesStatus}` : ''})`

  let prompt = `Game: ${scoreLine}\n`
  prompt += `Article: ${articleHeadline}. ${articleExcerpt}\n`

  if (benefactor) {
    prompt += `\nLeague fantasy winner: ${benefactor.teamName} — ${benefactor.fpts.toFixed(1)} pts`
    if (benefactor.topPlayers.length > 0) {
      prompt += ` (${benefactor.topPlayers.join(', ')})`
    }
  } else {
    prompt += '\nNo league members had players in this game.'
  }

  return prompt
}

// --- Constants ---

const NHL_API = 'https://api-web.nhle.com/v1'

const NHL_FETCH_INIT: RequestInit = {
  headers: {
    'User-Agent':
      'Mozilla/5.0 (compatible; HockeyPoolz/1.0; +https://hockey-poolz.vercel.app)',
    Accept: 'application/json',
  },
}

const GAME_SUMMARY_SYSTEM_PROMPT = `You are the host of a fantasy hockey radio show — loud, punchy, and fun. Write up to 4 sentences about this game. Give the game real color: the result, the momentum, a key moment or turning point, series context if relevant. End with a callout of the fantasy winner from this league — their team name, point total, and the player who delivered. More detail is better. Use the same voice throughout — enthusiastic, specific, a little bit of edge. No filler. No "In conclusion." Just the take.`

// --- NHL API ---

interface NhlGame {
  id: number
  gameState: string   // "OFF", "FINAL", "LIVE", etc.
  homeTeam: { abbrev: string; score?: number }
  awayTeam: { abbrev: string; score?: number }
  seriesStatus?: { seriesAbbrev?: string; round?: number; topSeedTeamAbbrev?: string; topSeedWins?: number; bottomSeedWins?: number }
  gameScheduleState?: string
}

interface NhlStoryBlock {
  type: string
  content?: string
}

async function fetchYesterdayGames(date: string): Promise<NhlGame[]> {
  const res = await fetch(`${NHL_API}/score/${date}`, NHL_FETCH_INIT)
  if (!res.ok) return []
  const data = await res.json()
  return data.games ?? []
}

async function fetchGameStory(gameId: number): Promise<{ headline: string; excerpt: string; url: string | null }> {
  try {
    const res = await fetch(`${NHL_API}/gamecenter/${gameId}/story`, NHL_FETCH_INIT)
    if (!res.ok) return { headline: '', excerpt: '', url: null }
    const data = await res.json()
    const headline = data.summary?.headline ?? data.headline ?? ''
    const blocks: NhlStoryBlock[] = data.summary?.items?.[0]?.content ?? data.items ?? []
    const excerpt = blocks
      .filter((b: NhlStoryBlock) => b.type === 'paragraph' || b.type === 'text')
      .slice(0, 2)
      .map((b: NhlStoryBlock) => b.content ?? '')
      .join(' ')
      .slice(0, 500)
    const url = data.summary?.url ?? data.url ?? null
    return { headline, excerpt, url }
  } catch {
    return { headline: '', excerpt: '', url: null }
  }
}

function formatSeriesStatus(game: NhlGame): string | null {
  const s = game.seriesStatus
  if (!s) return null
  const top = s.topSeedTeamAbbrev ?? ''
  const topW = s.topSeedWins ?? 0
  const botW = s.bottomSeedWins ?? 0
  if (topW === botW) return `Series tied ${topW}-${botW}`
  const leader = topW > botW ? top : (game.homeTeam.abbrev === top ? game.awayTeam.abbrev : game.homeTeam.abbrev)
  const wins = Math.max(topW, botW)
  const losses = Math.min(topW, botW)
  return `${leader} leads ${wins}-${losses}`
}

// --- Benefactor calculation ---

async function calcMemberScores(
  leagueId: string,
  nhlGameId: number,
  weights: ScoringWeights
): Promise<MemberGameScore[]> {
  const gameId = String(nhlGameId)

  const picks = await prisma.draftPick.findMany({
    where: { leagueMember: { leagueId } },
    include: {
      leagueMember: { select: { teamName: true } },
      player: {
        include: {
          gameStats: { where: { gameId } },
        },
      },
    },
  })

  const memberMap = new Map<string, MemberGameScore>()

  for (const pick of picks) {
    const stats = pick.player.gameStats[0]
    if (!stats) continue

    const fpts = calculatePlayerScore({
      goals: stats.goals, assists: stats.assists, plusMinus: stats.plusMinus,
      pim: stats.pim, shots: stats.shots, hits: stats.hits,
      blockedShots: stats.blockedShots, powerPlayGoals: stats.powerPlayGoals,
      powerPlayPoints: stats.powerPlayPoints,
      powerPlayAssists: stats.powerPlayPoints - stats.powerPlayGoals,
      shorthandedGoals: stats.shorthandedGoals,
      shorthandedPoints: stats.shorthandedPoints,
      shorthandedAssists: stats.shorthandedPoints - stats.shorthandedGoals,
      gameWinningGoals: stats.gameWinningGoals,
      overtimeGoals: stats.overtimeGoals, overtimeAssists: stats.overtimeAssists,
      goalieWins: stats.goalieWins,
      goalieSaves: stats.goalieSaves, shutouts: stats.shutouts, goalsAgainst: stats.goalsAgainst,
    }, weights)

    if (fpts <= 0) continue

    const teamName = pick.leagueMember.teamName
    const existing = memberMap.get(teamName)
    const playerLine = `${pick.player.name}: ${stats.goals}G ${stats.assists}A (${fpts.toFixed(1)} pts)`

    if (existing) {
      existing.fpts = Math.round((existing.fpts + fpts) * 100) / 100
      existing.topPlayers.push(playerLine)
    } else {
      memberMap.set(teamName, { teamName, fpts: Math.round(fpts * 100) / 100, topPlayers: [playerLine] })
    }
  }

  return Array.from(memberMap.values())
}

// --- Orchestration ---

/** Generate AI callouts for all completed games from yesterday. One record per league per game. */
export async function generateLeagueScoreSummaries(leagueId: string, date: string): Promise<void> {
  const games = await fetchYesterdayGames(date)
  const completedGames = games.filter(g =>
    g.gameState === 'OFF' || g.gameState === 'FINAL' || g.gameState === 'OFFICIAL'
  )
  if (completedGames.length === 0) return

  const settings = await prisma.scoringSettings.findUnique({ where: { leagueId } })
  if (!settings) return

  const weights: ScoringWeights = {
    goals: Number(settings.goals), assists: Number(settings.assists),
    plusMinus: Number(settings.plusMinus), pim: Number(settings.pim),
    shots: Number(settings.shots), hits: Number(settings.hits),
    blockedShots: Number(settings.blockedShots), powerPlayGoals: Number(settings.powerPlayGoals),
    powerPlayPoints: Number(settings.powerPlayPoints), powerPlayAssists: Number(settings.powerPlayAssists),
    shorthandedGoals: Number(settings.shorthandedGoals),
    shorthandedPoints: Number(settings.shorthandedPoints), shorthandedAssists: Number(settings.shorthandedAssists),
    gameWinningGoals: Number(settings.gameWinningGoals),
    overtimeGoals: Number(settings.overtimeGoals), overtimeAssists: Number(settings.overtimeAssists),
    goalieWins: Number(settings.goalieWins),
    goalieSaves: Number(settings.goalieSaves), shutouts: Number(settings.shutouts),
    goalsAgainst: Number(settings.goalsAgainst),
  }

  const client = new Anthropic()
  const gameDate = new Date(date)

  for (const game of completedGames) {
    // Skip if already generated
    const existingKey = `po-${game.id}`
    const exists = await prisma.leagueGameSummary.findUnique({
      where: { leagueId_gameId: { leagueId, gameId: existingKey } },
    })
    if (exists) continue

    const [story, memberScores] = await Promise.all([
      fetchGameStory(game.id),
      calcMemberScores(leagueId, game.id, weights),
    ])

    const benefactor = findBenefactor(memberScores)
    const seriesStatus = formatSeriesStatus(game)

    const userPrompt = buildGameSummaryPrompt({
      awayTeam: game.awayTeam.abbrev,
      homeTeam: game.homeTeam.abbrev,
      awayScore: game.awayTeam.score ?? 0,
      homeScore: game.homeTeam.score ?? 0,
      gameState: game.gameState,
      seriesStatus,
      articleHeadline: story.headline,
      articleExcerpt: story.excerpt,
      benefactor,
    })

    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 250,
        system: GAME_SUMMARY_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      })
      const block = response.content[0]
      if (block.type !== 'text') continue
      const content = block.text

      await prisma.leagueGameSummary.create({
        data: {
          leagueId,
          gameId: existingKey,
          gameDate,
          homeTeamId: game.homeTeam.abbrev,
          awayTeamId: game.awayTeam.abbrev,
          homeScore: game.homeTeam.score ?? 0,
          awayScore: game.awayTeam.score ?? 0,
          gameState: game.gameState,
          seriesStatus,
          articleUrl: story.url,
          content,
        },
      })
    } catch (err) {
      console.error(`Failed to generate summary for game ${game.id}:`, err)
    }

    // Small delay to avoid NHL API rate limiting
    await new Promise(r => setTimeout(r, 200))
  }
}
