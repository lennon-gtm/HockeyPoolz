/**
 * RecapService — prompt assembly, Claude API call, and recap generation.
 */

import Anthropic from '@anthropic-ai/sdk'
import { prisma } from './prisma'
import { calculatePlayerScore, type ScoringWeights } from './stats-service'
import { sendWhatsAppRecap } from './whatsapp-service'

// --- Types ---

export interface MemberPlayerStat {
  name: string
  opponent: string
  goals: number
  assists: number
  plusMinus: number
  weightedScore: number
}

export interface StandingEntry {
  rank: number
  teamName: string
  userName: string
  totalScore: number
}

export interface TopLeaguePlayer {
  name: string
  ownerTeam: string
  goals: number
  assists: number
  weightedScore: number
}

export interface RecapPromptInput {
  teamName: string
  currentRank: number
  standingChange: number
  memberPlayerStats: MemberPlayerStat[]
  standings: StandingEntry[]
  topLeaguePlayers: TopLeaguePlayer[]
}

export interface RecapGenerationResult {
  recapsCreated: number
  errors: string[]
}

export interface DailyScore {
  teamName: string
  fpts: number
}

export interface LeagueRecapPromptInput {
  leagueName: string
  dailyScores: DailyScore[]   // sorted best to worst
  standings: StandingEntry[]
}

export interface DraftDayPromptInput {
  leagueName: string
  teams: string[]   // in draft order
}

// --- Constants ---

const SYSTEM_PROMPT = `You are a sportscaster for a fantasy hockey playoff pool called HockeyPoolz. Write a 2-3 paragraph personalized morning recap for a participant. Be enthusiastic, slightly irreverent, and include friendly trash talk about other teams in the league. Reference specific players and stats. Keep it under 200 words.`

const LEAGUE_SYSTEM_PROMPT = `You are the host of a fantasy hockey radio show. You are loud, funny, and ruthless. You celebrate winners by name, and you roast the worst performers specifically and mercilessly — use their actual team name, their actual point total from yesterday, and make it sting. Keep it playful, never mean-spirited. 2–3 paragraphs, under 200 words.`

const DRAFT_DAY_SYSTEM_PROMPT = `You are the host of a fantasy hockey radio show on draft day. You are loud, funny, and ruthless. Riff on the team names — find the humor, the hubris, the delusion. Build anticipation for the pool. Keep it under 150 words, punchy, one paragraph. No filler. End with a hype line to kick things off.`

/** Generic Claude call — allows custom system prompt and token limit. */
async function callClaude(systemPrompt: string, userPrompt: string, maxTokens: number): Promise<string> {
  const client = new Anthropic()
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  })
  const block = response.content[0]
  if (block.type !== 'text') throw new Error('Unexpected response type from Claude API')
  return block.text
}

// --- Pure functions ---

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

/** Build the user prompt for a single member's recap. */
export function buildRecapPrompt(input: RecapPromptInput): string {
  const { teamName, currentRank, standingChange, memberPlayerStats, standings, topLeaguePlayers } = input

  const changeStr = standingChange > 0 ? `+${standingChange}` : String(standingChange)

  let prompt = `Team: ${teamName}\nCurrent rank: ${ordinal(currentRank)} place`
  if (standingChange !== 0) {
    prompt += ` (moved ${changeStr} since last recap)`
  }
  prompt += '\n'

  if (memberPlayerStats.length > 0) {
    prompt += '\nYour players last night:\n'
    for (const p of memberPlayerStats) {
      prompt += `- ${p.name} vs ${p.opponent}: ${p.goals}G ${p.assists}A ${p.plusMinus > 0 ? '+' : ''}${p.plusMinus} | ${p.weightedScore.toFixed(1)} fantasy pts\n`
    }
  } else {
    prompt += '\nNone of your players had games last night.\n'
  }

  prompt += '\nFull standings:\n'
  for (const s of standings) {
    prompt += `${s.rank}. ${s.teamName} (${s.userName}) — ${s.totalScore.toFixed(1)} pts\n`
  }

  if (topLeaguePlayers.length > 0) {
    prompt += '\nTop performers across the league last night:\n'
    for (const p of topLeaguePlayers) {
      prompt += `- ${p.name} (${p.ownerTeam}): ${p.goals}G ${p.assists}A | ${p.weightedScore.toFixed(1)} fantasy pts\n`
    }
  }

  return prompt
}

/** Build the prompt for the league-wide daily bulletin. */
export function buildLeagueRecapPrompt(input: LeagueRecapPromptInput): string {
  let prompt = `League: ${input.leagueName}\n\nYesterday's scores (best to worst):\n`
  for (const s of input.dailyScores) {
    prompt += `- ${s.teamName}: ${s.fpts.toFixed(1)} pts\n`
  }
  prompt += '\nCurrent standings:\n'
  for (const s of input.standings) {
    prompt += `${s.rank}. ${s.teamName} — ${s.totalScore.toFixed(1)} total pts\n`
  }
  return prompt
}

/** Build the prompt for the draft-day bulletin. */
export function buildDraftDayPrompt(input: DraftDayPromptInput): string {
  let prompt = `League: ${input.leagueName}\n\nTeams in draft order:\n`
  input.teams.forEach((t, i) => {
    prompt += `${i + 1}. ${t}\n`
  })
  return prompt
}

// --- Claude API ---

/** Generate recap text using Claude API. */
export async function generateRecapText(userPrompt: string): Promise<string> {
  return callClaude(SYSTEM_PROMPT, userPrompt, 400)
}

// --- Orchestration ---

/** Generate recaps for all eligible members in a league. */
export async function generateLeagueRecaps(leagueId: string): Promise<RecapGenerationResult> {
  const result: RecapGenerationResult = { recapsCreated: 0, errors: [] }

  const today = new Date()
  const recapDate = new Date(today.toISOString().split('T')[0]) // midnight UTC today

  // Load scoring settings for weight calculations
  const settings = await prisma.scoringSettings.findUnique({ where: { leagueId } })
  if (!settings) {
    result.errors.push(`No scoring settings for league ${leagueId}`)
    return result
  }

  const weights: ScoringWeights = {
    goals: Number(settings.goals), assists: Number(settings.assists),
    plusMinus: Number(settings.plusMinus), pim: Number(settings.pim),
    shots: Number(settings.shots), hits: Number(settings.hits),
    blockedShots: Number(settings.blockedShots),
    powerPlayGoals: Number(settings.powerPlayGoals),
    powerPlayPoints: Number(settings.powerPlayPoints),
    powerPlayAssists: Number(settings.powerPlayAssists),
    shorthandedGoals: Number(settings.shorthandedGoals),
    shorthandedPoints: Number(settings.shorthandedPoints),
    shorthandedAssists: Number(settings.shorthandedAssists),
    gameWinningGoals: Number(settings.gameWinningGoals),
    overtimeGoals: Number(settings.overtimeGoals),
    overtimeAssists: Number(settings.overtimeAssists),
    goalieWins: Number(settings.goalieWins), goalieSaves: Number(settings.goalieSaves),
    shutouts: Number(settings.shutouts), goalsAgainst: Number(settings.goalsAgainst),
  }

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { name: true },
  })
  const leagueName = league?.name ?? ''

  // Load all members with draft picks and their players
  const members = await prisma.leagueMember.findMany({
    where: { leagueId },
    include: {
      user: { select: { id: true, displayName: true } },
      draftPicks: {
        include: {
          player: {
            include: {
              team: { select: { abbreviation: true, eliminatedAt: true } },
              gameStats: {
                where: { NOT: { gameId: { startsWith: 'rs-' } } },
                orderBy: { gameDate: 'desc' },
              },
            },
          },
        },
      },
      recaps: { orderBy: { recapDate: 'desc' }, take: 1 },
    },
    orderBy: { totalScore: 'desc' },
  })

  // Build standings snapshot
  const standings: StandingEntry[] = members.map((m, i) => ({
    rank: i + 1,
    teamName: m.teamName,
    userName: m.user.displayName,
    totalScore: Number(m.totalScore),
  }))

  for (const member of members) {
    const currentRank = standings.findIndex(s => s.teamName === member.teamName) + 1
    const lastRecapDate = member.recaps[0]?.recapDate ?? null

    // Check if any drafted players had games since last recap
    const recentPlayerStats: MemberPlayerStat[] = []
    for (const pick of member.draftPicks) {
      const recentGames = pick.player.gameStats.filter(gs =>
        lastRecapDate ? gs.gameDate > lastRecapDate : true
      )
      for (const gs of recentGames) {
        const score = calculatePlayerScore({
          goals: gs.goals, assists: gs.assists, plusMinus: gs.plusMinus,
          pim: gs.pim, shots: gs.shots, hits: gs.hits,
          blockedShots: gs.blockedShots, powerPlayGoals: gs.powerPlayGoals,
          powerPlayPoints: gs.powerPlayPoints,
          powerPlayAssists: gs.powerPlayPoints - gs.powerPlayGoals,
          shorthandedGoals: gs.shorthandedGoals,
          shorthandedPoints: gs.shorthandedPoints,
          shorthandedAssists: gs.shorthandedPoints - gs.shorthandedGoals,
          gameWinningGoals: gs.gameWinningGoals,
          overtimeGoals: gs.overtimeGoals,
          overtimeAssists: gs.overtimeAssists,
          goalieWins: gs.goalieWins,
          goalieSaves: gs.goalieSaves, shutouts: gs.shutouts,
          goalsAgainst: gs.goalsAgainst,
        }, weights)
        recentPlayerStats.push({
          name: pick.player.name,
          opponent: pick.player.team.abbreviation,
          goals: gs.goals,
          assists: gs.assists,
          plusMinus: gs.plusMinus,
          weightedScore: Math.round(score * 100) / 100,
        })
      }
    }

    // Skip if no players had games
    if (recentPlayerStats.length === 0) continue

    const standingChange = 0

    // Build top league players (top 3 scorers from recent games, excluding this member's players)
    const allRecentScores: TopLeaguePlayer[] = []
    for (const otherMember of members) {
      if (otherMember.id === member.id) continue
      for (const pick of otherMember.draftPicks) {
        const recentGames = pick.player.gameStats.filter(gs =>
          lastRecapDate ? gs.gameDate > lastRecapDate : true
        )
        for (const gs of recentGames) {
          const score = calculatePlayerScore({
            goals: gs.goals, assists: gs.assists, plusMinus: gs.plusMinus,
            pim: gs.pim, shots: gs.shots, hits: gs.hits,
            blockedShots: gs.blockedShots, powerPlayGoals: gs.powerPlayGoals,
            powerPlayPoints: gs.powerPlayPoints,
            powerPlayAssists: gs.powerPlayPoints - gs.powerPlayGoals,
            shorthandedGoals: gs.shorthandedGoals,
            shorthandedPoints: gs.shorthandedPoints,
            shorthandedAssists: gs.shorthandedPoints - gs.shorthandedGoals,
            gameWinningGoals: gs.gameWinningGoals,
            overtimeGoals: gs.overtimeGoals,
            overtimeAssists: gs.overtimeAssists,
            goalieWins: gs.goalieWins,
            goalieSaves: gs.goalieSaves, shutouts: gs.shutouts,
            goalsAgainst: gs.goalsAgainst,
          }, weights)
          allRecentScores.push({
            name: pick.player.name,
            ownerTeam: otherMember.teamName,
            goals: gs.goals,
            assists: gs.assists,
            weightedScore: Math.round(score * 100) / 100,
          })
        }
      }
    }
    const topLeaguePlayers = allRecentScores
      .sort((a, b) => b.weightedScore - a.weightedScore)
      .slice(0, 3)

    // Build prompt and generate
    const userPrompt = buildRecapPrompt({
      teamName: member.teamName,
      currentRank,
      standingChange,
      memberPlayerStats: recentPlayerStats,
      standings,
      topLeaguePlayers,
    })

    try {
      const content = await generateRecapText(userPrompt)

      await prisma.recap.create({
        data: {
          leagueId,
          leagueMemberId: member.id,
          userId: member.user.id,
          recapDate,
          content,
          standingChange,
        },
      })

      // Send WhatsApp DM if member is opted in
      if (member.whatsappOptedIn && member.whatsappPhone && leagueName) {
        sendWhatsAppRecap(member.whatsappPhone, leagueName, content).catch(err =>
          result.errors.push(`WhatsApp failed for ${member.teamName}: ${err}`)
        )
      }

      result.recapsCreated++
    } catch (err) {
      result.errors.push(`Failed to generate recap for ${member.teamName}: ${err}`)
    }
  }

  return result
}

/** Generate the league-wide daily bulletin and store it. Skips if no games yesterday. */
export async function generateLeagueRecap(leagueId: string): Promise<void> {
  const yesterday = new Date()
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  const yesterdayStr = yesterday.toISOString().split('T')[0]
  const yesterdayDate = new Date(yesterdayStr)

  // Skip if no daily scores exist for yesterday
  const scoreCount = await prisma.memberDailyScore.count({
    where: { member: { leagueId }, gameDate: yesterdayDate },
  })
  if (scoreCount === 0) return

  // Skip if already generated today
  const todayStr = new Date().toISOString().split('T')[0]
  const todayDate = new Date(todayStr)
  const existing = await prisma.leagueRecap.findUnique({
    where: { leagueId_recapDate: { leagueId, recapDate: todayDate } },
  })
  if (existing) return

  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { name: true } })
  if (!league) return

  const [dailyScoreRows, memberRows] = await Promise.all([
    prisma.memberDailyScore.findMany({
      where: { member: { leagueId }, gameDate: yesterdayDate },
      include: { member: { select: { teamName: true } } },
      orderBy: { fpts: 'desc' },
    }),
    prisma.leagueMember.findMany({
      where: { leagueId },
      orderBy: { totalScore: 'desc' },
      select: { teamName: true, totalScore: true },
    }),
  ])

  const dailyScores: DailyScore[] = dailyScoreRows.map(r => ({
    teamName: r.member.teamName,
    fpts: Number(r.fpts),
  }))

  const standings: StandingEntry[] = memberRows.map((m, i) => ({
    rank: i + 1,
    teamName: m.teamName,
    userName: '',
    totalScore: Number(m.totalScore),
  }))

  const userPrompt = buildLeagueRecapPrompt({ leagueName: league.name, dailyScores, standings })
  const content = await callClaude(LEAGUE_SYSTEM_PROMPT, userPrompt, 500)

  await prisma.leagueRecap.create({
    data: { leagueId, recapDate: todayDate, content },
  })
}

/** Generate a draft-day roast bulletin when the draft goes live. */
export async function generateDraftDayBulletin(leagueId: string): Promise<void> {
  const todayStr = new Date().toISOString().split('T')[0]
  const todayDate = new Date(todayStr)

  // Skip if already generated today (idempotent)
  const existing = await prisma.leagueRecap.findUnique({
    where: { leagueId_recapDate: { leagueId, recapDate: todayDate } },
  })
  if (existing) return

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { name: true },
  })
  if (!league) return

  const members = await prisma.leagueMember.findMany({
    where: { leagueId },
    orderBy: { draftPosition: 'asc' },
    select: { teamName: true },
  })

  const teams = members.map(m => m.teamName)
  const userPrompt = buildDraftDayPrompt({ leagueName: league.name, teams })
  const content = await callClaude(DRAFT_DAY_SYSTEM_PROMPT, userPrompt, 350)

  await prisma.leagueRecap.create({
    data: { leagueId, recapDate: todayDate, content },
  })
}
