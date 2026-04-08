import type { PrismaClient } from '@prisma/client'

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

/**
 * Selects the best available player for an auto-pick.
 * Tries the member's wishlist (if strategy = 'wishlist') first, falls back to ADP.
 */
export async function getAutoPickPlayerId(
  draftId: string,
  leagueMemberId: string,
  strategy: 'adp' | 'wishlist',
  tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>
): Promise<number> {
  const drafted = await tx.draftPick.findMany({
    where: { draftId },
    select: { playerId: true },
  })
  const draftedIds = new Set(drafted.map(p => p.playerId))

  if (strategy === 'wishlist') {
    const wishlist = await tx.autodraftWishlist.findMany({
      where: { leagueMemberId },
      orderBy: { rank: 'asc' },
      select: { playerId: true },
    })
    for (const { playerId } of wishlist) {
      if (!draftedIds.has(playerId)) return playerId
    }
  }

  const best = await tx.nhlPlayer.findFirst({
    where: {
      // notIn([]) generates invalid SQL in some Prisma versions; -1 matches no real player ID
      id: { notIn: draftedIds.size > 0 ? [...draftedIds] : [-1] },
      isActive: true,
    },
    orderBy: { adp: { sort: 'asc', nulls: 'last' } },
  })
  if (!best) throw new Error('No available players for auto-pick')
  return best.id
}
