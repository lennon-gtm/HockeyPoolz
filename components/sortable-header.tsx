export type SortDirection = 'asc' | 'desc' | null

interface Props {
  label: string
  active: boolean
  direction: SortDirection
  onClick: () => void
  align?: 'left' | 'center' | 'right'
  highlight?: boolean
}

export function SortableHeader({ label, active, direction, onClick, align = 'center', highlight = false }: Props) {
  const indicator = !active ? '↕' : direction === 'asc' ? '↑' : '↓'
  const color = highlight ? 'text-[#0042bb]' : active ? 'text-[#121212]' : 'text-[#98989e]'
  const bg = highlight ? 'bg-[#e8f0ff] rounded px-1 py-0.5' : ''
  const alignClass = align === 'right' ? 'text-right' : align === 'left' ? 'text-left' : 'text-center'

  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[9px] font-bold uppercase tracking-wider cursor-pointer ${color} ${bg} ${alignClass} whitespace-nowrap`}
    >
      {label} <span className="inline-block w-2">{indicator}</span>
    </button>
  )
}
