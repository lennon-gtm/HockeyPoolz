import type { PrismaClient } from '@prisma/client'
import { Prisma } from '@prisma/client'

/**
 * Returns the 0-indexed position in the sorted members array for a given pick number.
 * Odd rounds pick left-to-right, even rounds pick right-to-left (snake).
 */
export function getPickerIndex(pickNumber: number, memberCount: number): number {
  const round = Math.ceil(pickNumber / memberCount)
  const posInRound = (pickNumber - 1) % memberCount
  return round % 2 === 1 ? posInRound : memberCount - 1 - posInRound
}

/** Returns the 1-indexed round number for a given pick in an N-member draft. */
export function getRound(pickNumber: number, memberCount: number): number {
  return Math.ceil(pickNumber / memberCount)
}

/** Total picks = members × players per team (number of rounds). */
export function getTotalPicks(memberCount: number, playersPerTeam: number): number {
  return memberCount * playersPerTeam
}

export interface PositionCaps {
  rosterForwards: number
  rosterDefense: number
  rosterGoalies: number
}

export interface PositionCounts { F: number; D: number; G: number }

type TxClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>

export function getPositionCounts(positions: readonly string[]): PositionCounts {
  const counts: PositionCounts = { F: 0, D: 0, G: 0 }
  for (const p of positions) {
    if (p === 'G') counts.G++
    else if (p === 'D') counts.D++
    else counts.F++ // C / LW / RW bucket as forwards
  }
  return counts
}

export function isPositionFull(
  position: string,
  counts: PositionCounts,
  caps: PositionCaps,
): boolean {
  if (position === 'G') return counts.G >= caps.rosterGoalies
  if (position === 'D') return counts.D >= caps.rosterDefense
  return counts.F >= caps.rosterForwards
}

function fullPositions(counts: PositionCounts, caps: PositionCaps): string[] {
  const out: string[] = []
  if (counts.F >= caps.rosterForwards) out.push('C', 'LW', 'RW')
  if (counts.D >= caps.rosterDefense) out.push('D')
  if (counts.G >= caps.rosterGoalies) out.push('G')
  return out
}

async function getMemberPositionCounts(
  draftId: string,
  leagueMemberId: string,
  tx: TxClient,
): Promise<PositionCounts> {
  const picks = await tx.draftPick.findMany({
    where: { draftId, leagueMemberId },
    select: { player: { select: { position: true } } },
  })
  return getPositionCounts(picks.map(p => p.player.position))
}

/**
 * Selects the best available player for an auto-pick.
 *
 * Ordering:
 *   1. Wishlist (if strategy === 'wishlist') — respecting position caps.
 *   2. Best 2025-26 regular-season producer: sum(goals + assists) desc,
 *      sum(goalieWins) desc (so top goalies surface after all skaters are
 *      accounted for), then ADP asc as a last tiebreaker.
 *
 * Players whose position is already full for this member are excluded so the
 * commissioner's roster caps are enforced on auto-picks too.
 */
export async function getAutoPickPlayerId(
  draftId: string,
  leagueMemberId: string,
  strategy: 'adp' | 'wishlist',
  caps: PositionCaps,
  tx: TxClient,
): Promise<number> {
  const drafted = await tx.draftPick.findMany({
    where: { draftId },
    select: { playerId: true },
  })
  const draftedIds = new Set(drafted.map(p => p.playerId))

  const counts = await getMemberPositionCounts(draftId, leagueMemberId, tx)
  const excludedPositions = fullPositions(counts, caps)

  if (strategy === 'wishlist') {
    const wishlist = await tx.autodraftWishlist.findMany({
      where: { leagueMemberId },
      orderBy: { rank: 'asc' },
      include: { player: { select: { id: true, position: true } } },
    })
    for (const { player } of wishlist) {
      if (draftedIds.has(player.id)) continue
      if (excludedPositions.includes(player.position)) continue
      return player.id
    }
  }

  const excludeIds = [...draftedIds]
  const excludeIdsSql = excludeIds.length > 0
    ? Prisma.sql`AND p.id NOT IN (${Prisma.join(excludeIds)})`
    : Prisma.empty
  const excludePosSql = excludedPositions.length > 0
    ? Prisma.sql`AND p.position::text NOT IN (${Prisma.join(excludedPositions)})`
    : Prisma.empty

  const rows = await tx.$queryRaw<{ id: number }[]>(Prisma.sql`
    SELECT p.id
    FROM nhl_players p
    LEFT JOIN (
      SELECT player_id,
             SUM(goals) + SUM(assists) AS pts,
             SUM(goalie_wins) AS wins
      FROM player_game_stats
      GROUP BY player_id
    ) s ON s.player_id = p.id
    WHERE p.is_active = true
      ${excludeIdsSql}
      ${excludePosSql}
    ORDER BY COALESCE(s.pts, 0) DESC,
             COALESCE(s.wins, 0) DESC,
             p.adp ASC NULLS LAST
    LIMIT 1
  `)

  if (!rows.length) throw new Error('No available players for auto-pick')
  return Number(rows[0].id)
}

/**
 * Asserts the picker can still add this player given the league's position
 * caps. Throws a user-facing error message if not.
 */
export async function assertPositionCap(
  draftId: string,
  leagueMemberId: string,
  playerPosition: string,
  caps: PositionCaps,
  tx: TxClient,
): Promise<void> {
  const counts = await getMemberPositionCounts(draftId, leagueMemberId, tx)
  if (isPositionFull(playerPosition, counts, caps)) {
    const bucket = playerPosition === 'G' ? 'Goalie' : playerPosition === 'D' ? 'Defense' : 'Forward'
    const max = playerPosition === 'G'
      ? caps.rosterGoalies
      : playerPosition === 'D'
        ? caps.rosterDefense
        : caps.rosterForwards
    throw new Error(`${bucket} slots are full (${max} max for this league)`)
  }
}
