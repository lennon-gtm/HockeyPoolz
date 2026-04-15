export interface RosterCaps {
  rosterForwards: number
  rosterDefense: number
  rosterGoalies: number
}

export function rosterTotal(caps: RosterCaps): number {
  return caps.rosterForwards + caps.rosterDefense + caps.rosterGoalies
}
