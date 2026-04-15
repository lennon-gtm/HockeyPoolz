export type PlayerPosition = 'F' | 'D' | 'G'

interface Props {
  position: PlayerPosition
  size?: 'xs' | 'sm'
}

const STYLES: Record<PlayerPosition, { bg: string; text: string }> = {
  F: { bg: 'bg-[#e8f4fd]', text: 'text-[#0042bb]' },
  D: { bg: 'bg-[#fce8f3]', text: 'text-[#8b008b]' },
  G: { bg: 'bg-[#fff3e0]', text: 'text-[#e65100]' },
}

export function PositionBadge({ position, size = 'sm' }: Props) {
  const { bg, text } = STYLES[position]
  const sizeClass = size === 'xs' ? 'text-[9px] px-1 py-[2px]' : 'text-[10px] px-1.5 py-[2px]'
  return (
    <span className={`inline-block rounded font-bold ${bg} ${text} ${sizeClass}`}>
      {position}
    </span>
  )
}
