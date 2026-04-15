type Size = 'sm' | 'md' | 'lg'

interface Props {
  icon: string | null
  size?: Size
}

export function TeamIcon({ icon, size = 'md' }: Props) {
  const sizeClass =
    size === 'sm' ? 'w-6 h-6 text-base' :
    size === 'lg' ? 'w-10 h-10 text-2xl' :
    'w-8 h-8 text-xl'

  if (icon?.startsWith('https://')) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={icon} alt="" className={`${sizeClass} rounded-full object-cover`} />
  }

  const textSize = size === 'sm' ? 'text-base' : size === 'lg' ? 'text-2xl' : 'text-xl'
  return <span className={textSize}>{icon || '🏒'}</span>
}
