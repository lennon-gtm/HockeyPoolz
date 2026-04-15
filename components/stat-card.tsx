interface Props {
  value: React.ReactNode
  label: string
  tone?: 'default' | 'positive' | 'negative' | 'dark'
  onClick?: () => void
  icon?: React.ReactNode
}

export function StatCard({ value, label, tone = 'default', onClick, icon }: Props) {
  const bg = tone === 'dark' ? 'bg-[#1a1a1a] text-white' : 'bg-[#f8f8f8]'
  const valueColor =
    tone === 'positive' ? 'text-[#2db944]' :
    tone === 'negative' ? 'text-[#c8102e]' :
    tone === 'dark' ? 'text-white' :
    'text-[#121212]'
  const labelColor = tone === 'dark' ? 'text-white/70' : 'text-[#98989e]'
  const clickable = onClick ? 'cursor-pointer hover:brightness-95 active:brightness-90' : ''

  return (
    <div onClick={onClick} className={`${bg} ${clickable} rounded-lg p-2.5 text-center transition`}>
      {icon && <div className="text-base mb-0.5">{icon}</div>}
      <div className={`text-xl font-black leading-none ${valueColor}`}>{value}</div>
      <div className={`text-[9px] font-bold uppercase tracking-widest mt-1 ${labelColor}`}>{label}</div>
    </div>
  )
}
