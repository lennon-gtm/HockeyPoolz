'use client'

export interface RosterValues {
  rosterForwards: number
  rosterDefense: number
  rosterGoalies: number
}

interface Props {
  value: RosterValues
  onChange: (next: RosterValues) => void
  disabled?: boolean
}

interface Row {
  key: keyof RosterValues
  label: string
  min: number
  max: number
}

const ROWS: Row[] = [
  { key: 'rosterForwards', label: 'Forwards', min: 1, max: 12 },
  { key: 'rosterDefense',  label: 'Defensemen', min: 1, max: 8 },
  { key: 'rosterGoalies',  label: 'Goalies',  min: 1, max: 4 },
]

export function RosterSliders({ value, onChange, disabled }: Props) {
  const total = value.rosterForwards + value.rosterDefense + value.rosterGoalies

  return (
    <div>
      {ROWS.map(row => (
        <div key={row.key} className="mb-4">
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-semibold text-[#121212]">{row.label}</label>
            <span className="text-sm font-black text-[#121212]">{value[row.key]}</span>
          </div>
          <input
            type="range"
            min={row.min}
            max={row.max}
            value={value[row.key]}
            disabled={disabled}
            onChange={e => onChange({ ...value, [row.key]: Number(e.target.value) })}
            className="w-full accent-orange-500 disabled:opacity-50"
          />
        </div>
      ))}
      <p className="text-xs text-[#98989e] font-bold uppercase tracking-widest">Total: {total} players per team</p>
    </div>
  )
}
