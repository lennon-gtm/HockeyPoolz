export interface PoolSummary {
  id: string
  name: string
}

export type LandingAction =
  | { action: 'show-create' }
  | { action: 'show-selector'; clearDefault?: true }
  | { action: 'redirect'; poolId: string }

export function decideLandingAction(
  leagues: PoolSummary[],
  defaultPoolId: string | null,
  pickMode: boolean,
): LandingAction {
  if (leagues.length === 0) return { action: 'show-create' }
  if (pickMode) return { action: 'show-selector' }
  if (defaultPoolId) {
    const found = leagues.some(l => l.id === defaultPoolId)
    if (found) return { action: 'redirect', poolId: defaultPoolId }
    return { action: 'show-selector', clearDefault: true }
  }
  if (leagues.length === 1) return { action: 'redirect', poolId: leagues[0].id }
  return { action: 'show-selector' }
}
