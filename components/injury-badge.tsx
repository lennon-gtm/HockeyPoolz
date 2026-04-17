export type InjuryStatus = 'DTD' | 'OUT' | 'LTIR'

interface Props {
  status: InjuryStatus | null | undefined
  size?: 'xs' | 'sm'
}

const STYLES: Record<InjuryStatus, { bg: string; text: string; title: string }> = {
  DTD:  { bg: 'bg-[#fff4d6]', text: 'text-[#a15c00]', title: 'Day-to-day' },
  OUT:  { bg: 'bg-[#fde2e2]', text: 'text-[#c8102e]', title: 'Out' },
  LTIR: { bg: 'bg-[#f3d4d4]', text: 'text-[#8b0014]', title: 'Long-term injured reserve' },
}

export function InjuryBadge({ status, size = 'sm' }: Props) {
  if (!status) return null
  const { bg, text, title } = STYLES[status]
  const sizeClass = size === 'xs' ? 'text-[8px] px-1 py-[1px]' : 'text-[9px] px-1.5 py-[2px]'
  return (
    <span
      title={title}
      className={`inline-block rounded font-bold uppercase tracking-wider ${bg} ${text} ${sizeClass}`}
    >
      {status}
    </span>
  )
}
