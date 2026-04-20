import Link from 'next/link'

/** Small right-aligned "Powered by Signyl" strip used as the app-wide footer. */
export function PoweredBySignyl({ variant = 'light' }: { variant?: 'light' | 'dark' }) {
  const isDark = variant === 'dark'
  return (
    <footer
      className={`w-full px-4 py-2 flex justify-end ${
        isDark ? 'bg-[#0d0d0d] border-t border-white/10' : 'bg-white border-t border-[#f0f0f0]'
      }`}
    >
      <Link
        href="https://signyl.gg"
        target="_blank"
        rel="noopener noreferrer"
        className={`text-[10px] font-bold uppercase tracking-[2px] ${
          isDark ? 'text-white/60 hover:text-white' : 'text-[#98989e] hover:text-[#515151]'
        } transition`}
      >
        Powered by <span className={isDark ? 'text-[#f97316]' : 'text-[#f97316]'}>Signyl</span>
      </Link>
    </footer>
  )
}
