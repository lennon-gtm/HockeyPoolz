import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const NHL_API_BASE = 'https://api-web.nhle.com/v1'
const SEASON = '20252026'
const GAME_TYPE_RS = '2' // regular season

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
  toi?: string
  // goalie fields
  shotsAgainst?: number
  goalsAgainst?: number
  shutouts?: number
  decision?: string
}

async function fetchRegularSeasonGameLog(playerId: number): Promise<NhlGameLogEntry[]> {
  const res = await fetch(`${NHL_API_BASE}/player/${playerId}/game-log/${SEASON}/${GAME_TYPE_RS}`)
  if (!res.ok) throw new Error(`NHL API game-log/${playerId} returned ${res.status}`)
  const data = await res.json()
  return data.gameLog ?? []
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const offset = parseInt(searchParams.get('offset') ?? '0', 10)
  const limit = parseInt(searchParams.get('limit') ?? '50', 10)

  const allPlayers = await prisma.nhlPlayer.findMany({
    where: { isActive: true, team: { playoffQualified: true } },
    select: { id: true, name: true },
    orderBy: { id: 'asc' },
  })

  const players = allPlayers.slice(offset, offset + limit)
  const totalPlayers = allPlayers.length

  let playersProcessed = 0
  let gamesUpserted = 0
  const errors: string[] = []

  for (const player of players) {
    try {
      const gameLog = await fetchRegularSeasonGameLog(player.id)

      for (const entry of gameLog) {
        const gameId = `rs-${entry.gameId}`
        const isGoalie = entry.decision !== undefined

        await prisma.playerGameStats.upsert({
          where: { playerId_gameId: { playerId: player.id, gameId } },
          update: {
            goals: entry.goals ?? 0,
            assists: entry.assists ?? 0,
            plusMinus: entry.plusMinus ?? 0,
            pim: entry.pim ?? 0,
            shots: entry.shots ?? 0,
            powerPlayGoals: entry.powerPlayGoals ?? 0,
            powerPlayPoints: entry.powerPlayPoints ?? 0,
            shorthandedGoals: entry.shorthandedGoals ?? 0,
            shorthandedPoints: entry.shorthandedPoints ?? 0,
            gameWinningGoals: entry.gameWinningGoals ?? 0,
            overtimeGoals: entry.otGoals ?? 0,
            goalieWins: isGoalie && entry.decision === 'W' ? 1 : 0,
            goalieSaves: isGoalie ? ((entry.shotsAgainst ?? 0) - (entry.goalsAgainst ?? 0)) : 0,
            goalsAgainst: isGoalie ? (entry.goalsAgainst ?? 0) : 0,
            shutouts: isGoalie ? (entry.shutouts ?? 0) : 0,
          },
          create: {
            playerId: player.id,
            gameId,
            gameDate: new Date(entry.gameDate),
            goals: entry.goals ?? 0,
            assists: entry.assists ?? 0,
            plusMinus: entry.plusMinus ?? 0,
            pim: entry.pim ?? 0,
            shots: entry.shots ?? 0,
            powerPlayGoals: entry.powerPlayGoals ?? 0,
            powerPlayPoints: entry.powerPlayPoints ?? 0,
            shorthandedGoals: entry.shorthandedGoals ?? 0,
            shorthandedPoints: entry.shorthandedPoints ?? 0,
            gameWinningGoals: entry.gameWinningGoals ?? 0,
            overtimeGoals: entry.otGoals ?? 0,
            goalieWins: isGoalie && entry.decision === 'W' ? 1 : 0,
            goalieSaves: isGoalie ? ((entry.shotsAgainst ?? 0) - (entry.goalsAgainst ?? 0)) : 0,
            goalsAgainst: isGoalie ? (entry.goalsAgainst ?? 0) : 0,
            shutouts: isGoalie ? (entry.shutouts ?? 0) : 0,
          },
        })
        gamesUpserted++
      }

      playersProcessed++
      // Small delay to avoid NHL API rate limiting
      await sleep(150)
    } catch (err) {
      errors.push(`${player.name} (${player.id}): ${err}`)
    }
  }

  const nextOffset = offset + limit
  const hasMore = nextOffset < totalPlayers

  return NextResponse.json({
    success: true,
    playersProcessed,
    gamesUpserted,
    errors,
    offset,
    limit,
    totalPlayers,
    nextOffset: hasMore ? nextOffset : null,
    done: !hasMore,
  })
}
