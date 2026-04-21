'use client'
import { useState, useEffect } from 'react'
import {
  signInWithPopup, GoogleAuthProvider,
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, onAuthStateChanged,
} from 'firebase/auth'
import { auth } from '@/lib/firebase/client'
import { useRouter } from 'next/navigation'
import { decideLandingAction, type PoolSummary } from '@/lib/pool-selection'

const DEFAULT_POOL_KEY = 'hockeypoolz:defaultPoolId'

type Mode = 'idle' | 'email'
type EmailAction = 'signIn' | 'signUp'

const STEPS = [
  { icon: '🏒', num: 'Step 1', label: 'Join or create a pool' },
  { icon: '🧊', num: 'Step 2', label: 'Draft your playoff roster' },
  { icon: '🏆', num: 'Step 3', label: 'Track every goal live' },
]

type AuthPhase = 'checking' | 'unauth' | 'auth'

export default function LandingPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<Mode>('idle')
  const [emailAction, setEmailAction] = useState<EmailAction>('signIn')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [info, setInfo] = useState('')
  const [phase, setPhase] = useState<AuthPhase>('checking')
  const [currentUser, setCurrentUser] = useState<import('firebase/auth').User | null>(null)
  const [leagues, setLeagues] = useState<PoolSummary[] | null>(null)
  const [defaultPoolId, setDefaultPoolId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setDefaultPoolId(localStorage.getItem(DEFAULT_POOL_KEY))
    }
  }, [])

  function togglePin(poolId: string, poolName: string) {
    if (defaultPoolId === poolId) {
      localStorage.removeItem(DEFAULT_POOL_KEY)
      setDefaultPoolId(null)
      setToast('No default pool set.')
    } else {
      localStorage.setItem(DEFAULT_POOL_KEY, poolId)
      setDefaultPoolId(poolId)
      setToast(`HockeyPoolz will open ${poolName} next time.`)
    }
    setTimeout(() => setToast(null), 3000)
  }

  useEffect(() => {
    let unsub: (() => void) | undefined
    auth.authStateReady().then(() => {
      unsub = onAuthStateChanged(auth, (user) => {
        setCurrentUser(user)
        setPhase(user ? 'auth' : 'unauth')
      })
    })
    return () => unsub?.()
  }, [])

  useEffect(() => {
    if (phase !== 'auth' || !currentUser) return
    let cancelled = false
    async function loadLeagues() {
      const token = await currentUser!.getIdToken()
      const res = await fetch('/api/leagues', { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) {
        if (!cancelled) setLeagues([])
        return
      }
      const data = await res.json()
      if (!cancelled) {
        setLeagues((data.leagues ?? []).map((l: { id: string; name: string }) => ({ id: l.id, name: l.name })))
      }
    }
    loadLeagues()
    return () => { cancelled = true }
  }, [phase, currentUser])

  useEffect(() => {
    if (phase !== 'auth' || leagues === null) return
    const params = new URLSearchParams(window.location.search)
    const pickMode = params.get('pick') === '1'
    const defaultId = typeof window !== 'undefined' ? localStorage.getItem(DEFAULT_POOL_KEY) : null
    const decision = decideLandingAction(leagues, defaultId, pickMode)

    if (decision.action === 'redirect') {
      router.replace(`/league/${decision.poolId}`)
      return
    }
    if (decision.action === 'show-selector' && decision.clearDefault) {
      localStorage.removeItem(DEFAULT_POOL_KEY)
    }
  }, [phase, leagues, router])

  async function finishSignIn(user: { getIdToken: () => Promise<string> }) {
    const token = await user.getIdToken()
    const res = await fetch('/api/auth/me', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error('me-failed')
    document.cookie = `session=${token}; path=/; max-age=3600; SameSite=Strict`
    router.push('/')
  }

  async function signInWithGoogle() {
    setLoading(true)
    setError('')
    try {
      const result = await signInWithPopup(auth, new GoogleAuthProvider())
      await finishSignIn(result.user)
    } catch (err: unknown) {
      if ((err as { code?: string }).code !== 'auth/popup-closed-by-user') {
        setError('Sign in failed. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setInfo('')
    try {
      const result = emailAction === 'signUp'
        ? await createUserWithEmailAndPassword(auth, email, password)
        : await signInWithEmailAndPassword(auth, email, password)
      await finishSignIn(result.user)
    } catch (err: unknown) {
      const code = (err as { code?: string }).code
      if (emailAction === 'signUp' && code === 'auth/email-already-in-use') {
        setError('An account with that email already exists. Try signing in instead.')
      } else if (emailAction === 'signUp' && code === 'auth/weak-password') {
        setError('Password must be at least 6 characters.')
      } else if (code === 'auth/invalid-email') {
        setError('Please enter a valid email address.')
      } else if (code === 'auth/user-not-found' || code === 'auth/invalid-credential' || code === 'auth/wrong-password') {
        setError('Incorrect email or password.')
      } else if (code === 'auth/too-many-requests') {
        setError('Too many attempts. Try again later.')
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  async function resetPassword() {
    setError('')
    setInfo('')
    if (!email) {
      setError('Enter your email above, then tap Forgot password.')
      return
    }
    setLoading(true)
    try {
      await sendPasswordResetEmail(auth, email)
      setInfo('Password reset email sent. Check your inbox.')
    } catch (err: unknown) {
      const code = (err as { code?: string }).code
      if (code === 'auth/invalid-email') {
        setError('Please enter a valid email address.')
      } else {
        setError('Could not send reset email. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  const pillBase: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
    padding: '13px 24px', borderRadius: 9999,
    fontFamily: 'var(--font-nunito, Nunito, sans-serif)', fontSize: 15, fontWeight: 800,
    cursor: 'pointer', border: 'none', width: '100%',
    transition: 'transform 0.15s ease, box-shadow 0.15s ease',
    opacity: loading ? 0.6 : 1,
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '12px 16px', borderRadius: 12,
    border: '2px solid #e5e7eb', fontSize: 15,
    fontFamily: 'var(--font-nunito, Nunito, sans-serif)',
    outline: 'none', background: '#fff',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#0d0d0d', fontFamily: 'var(--font-nunito, Nunito, sans-serif)' }}>

      {/* ── Header ── */}
      <header style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 48px' }}>
        <span style={{ fontFamily: 'var(--font-bebas, "Bebas Neue", sans-serif)', fontSize: 32, fontWeight: 400, color: '#fff', textShadow: '0 2px 8px rgba(0,0,0,0.5)', letterSpacing: '1px' }}>
          HockeyPoolz
        </span>
        <nav>
          <a href="#steps" style={{ color: '#fff', textDecoration: 'none', marginLeft: 24, fontSize: 14, fontWeight: 700, textShadow: '0 1px 4px rgba(0,0,0,0.25)', opacity: 0.9 }}>
            How it works
          </a>
        </nav>
      </header>

      {/* ── Hero ── */}
      <section style={{
        flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', minHeight: 0,
        backgroundImage: 'url(/bell-center-fire.jpg)',
        backgroundSize: 'cover',
        backgroundPosition: 'center top',
      }}>
        {/* Dark overlay — solid left fading to transparent right */}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to right, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.70) 25%, rgba(0,0,0,0.20) 55%, rgba(0,0,0,0.00) 75%)' }} />

        {/* Content */}
        <div style={{ position: 'relative', zIndex: 2, padding: '72px 52px 32px', maxWidth: 520 }}>

          {/* Eyebrow */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 11, fontWeight: 800, letterSpacing: '2.5px', textTransform: 'uppercase', color: '#f97316', marginBottom: 12 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/nhl-shield.png" alt="BCHL" style={{ width: 28, height: 32, objectFit: 'contain' }} />
            BCHL Inaugural Playoff Pool
          </div>

          {/* Heading */}
          <h1 style={{ fontFamily: 'var(--font-bebas, "Bebas Neue", sans-serif)', fontSize: 'clamp(48px, 6vw, 80px)', fontWeight: 400, lineHeight: 1.0, color: '#ffffff', marginBottom: 14, letterSpacing: '1px' }}>
            Your Pool.<br />
            Your Players.<br />
            Your <span style={{ color: '#f97316' }}>Glory.</span>
          </h1>

          {/* Subtext */}
          <p style={{ fontSize: 15, fontWeight: 500, color: 'rgba(255,255,255,0.80)', lineHeight: 1.6, marginBottom: 24, maxWidth: 380 }}>
            Pick your NHL playoff roster, compete with friends, and get play by play updates straight to your phone.
          </p>

          {/* CTA — gated on auth phase */}
          {phase === 'checking' && (
            <div className="w-full h-[52px] rounded-full bg-white/10 animate-pulse" style={{ maxWidth: 280 }} />
          )}

          {phase === 'auth' && leagues === null && (
            <div className="w-full h-[52px] rounded-full bg-white/10 animate-pulse" style={{ maxWidth: 280 }} />
          )}

          {phase === 'auth' && leagues !== null && leagues.length === 0 && (
            <div className="w-full flex flex-col gap-3" style={{ maxWidth: 280 }}>
              <button
                onClick={() => router.push('/league/create')}
                className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3.5 rounded-full transition"
                style={{ fontFamily: 'var(--font-nunito, Nunito, sans-serif)' }}
              >
                Create a Pool
              </button>
              <p className="text-xs text-gray-400 text-center">Got an invite link? Open it to join a pool.</p>
            </div>
          )}

          {phase === 'auth' && leagues !== null && leagues.length > 0 && (
            <div className="w-full flex flex-col gap-2" style={{ maxWidth: 320 }}>
              {leagues.map(l => {
                const isDefault = defaultPoolId === l.id
                return (
                  <div key={l.id} className="flex items-center gap-2">
                    <button
                      onClick={() => router.push(`/league/${l.id}`)}
                      className="flex-1 bg-orange-500 hover:bg-orange-600 text-white font-bold py-3.5 rounded-full transition text-left px-6"
                      style={{ fontFamily: 'var(--font-nunito, Nunito, sans-serif)' }}
                    >
                      Enter {l.name} →
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); togglePin(l.id, l.name) }}
                      aria-label={isDefault ? `Clear ${l.name} as default pool` : `Set ${l.name} as default pool`}
                      className="w-11 h-11 rounded-full flex items-center justify-center transition flex-shrink-0"
                      style={{
                        background: isDefault ? '#c8a060' : 'transparent',
                        border: `1.5px solid ${isDefault ? '#c8a060' : 'rgba(255,255,255,0.35)'}`,
                        color: isDefault ? '#1a1612' : 'rgba(255,255,255,0.85)',
                      }}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill={isDefault ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                        <path d="M12 2l2 7h7l-5.5 4 2 7L12 16l-5.5 4 2-7L3 9h7z" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </div>
                )
              })}
              {toast && (
                <p className="text-xs text-center mt-2" style={{ color: '#c8a060' }}>{toast}</p>
              )}
            </div>
          )}

          {phase === 'unauth' && (
            <>
              {/* Error / Info */}
              {error && (
                <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</p>
              )}
              {info && (
                <p style={{ color: '#16a34a', fontSize: 13, marginBottom: 12 }}>{info}</p>
              )}

              {/* Auth — idle */}
              {mode === 'idle' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 280 }}>
                  <button onClick={signInWithGoogle} disabled={loading} style={{ ...pillBase, background: '#fff', color: '#222', boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }}>
                    <GoogleSVG />
                    Continue with Google
                  </button>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#9ca3af', fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>
                    <span style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
                    or
                    <span style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
                  </div>

                  <button onClick={() => setMode('email')} disabled={loading} style={{ ...pillBase, background: '#fff7ed', color: '#c2410c', border: '2px solid #fed7aa' }}>
                    <EmailSVG />
                    Continue with Email
                  </button>
                </div>
              )}

              {/* Auth — email form */}
              {mode === 'email' && (
                <form onSubmit={submitEmail} style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 280 }}>
                  {/* Sign in / Sign up toggle */}
                  <div style={{ display: 'flex', background: '#fff', borderRadius: 9999, padding: 4, gap: 4 }}>
                    {(['signIn', 'signUp'] as const).map(a => (
                      <button
                        type="button"
                        key={a}
                        onClick={() => { setEmailAction(a); setError(''); setInfo('') }}
                        style={{
                          flex: 1, padding: '8px 12px', borderRadius: 9999, border: 'none',
                          fontSize: 13, fontWeight: 800, cursor: 'pointer',
                          background: emailAction === a ? '#f97316' : 'transparent',
                          color: emailAction === a ? '#fff' : '#6b7280',
                          fontFamily: 'var(--font-nunito, Nunito, sans-serif)',
                        }}
                      >
                        {a === 'signIn' ? 'Sign in' : 'Sign up'}
                      </button>
                    ))}
                  </div>
                  <input
                    type="email"
                    placeholder="Email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    style={inputStyle}
                  />
                  <input
                    type="password"
                    placeholder={emailAction === 'signUp' ? 'Password (6+ characters)' : 'Password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    minLength={emailAction === 'signUp' ? 6 : undefined}
                    autoComplete={emailAction === 'signUp' ? 'new-password' : 'current-password'}
                    style={inputStyle}
                  />
                  <button type="submit" disabled={loading} style={{ ...pillBase, background: '#f97316', color: '#fff', boxShadow: '0 4px 16px rgba(249,115,22,0.3)' }}>
                    {loading
                      ? (emailAction === 'signUp' ? 'Creating account…' : 'Signing in…')
                      : (emailAction === 'signUp' ? 'Create Account' : 'Sign In')}
                  </button>
                  {emailAction === 'signIn' && (
                    <button
                      type="button"
                      onClick={resetPassword}
                      disabled={loading}
                      style={{ background: 'none', border: 'none', color: '#f97316', fontSize: 12, fontWeight: 700, cursor: 'pointer', textAlign: 'left', padding: '2px 0', fontFamily: 'var(--font-nunito, Nunito, sans-serif)' }}
                    >
                      Forgot password?
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => { setMode('idle'); setError(''); setInfo('') }}
                    style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 13, cursor: 'pointer', textAlign: 'left', padding: '4px 0', fontFamily: 'var(--font-nunito, Nunito, sans-serif)' }}
                  >
                    ← Back
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </section>

      {/* ── How it works strip ── */}
      <section id="steps" className="steps-strip">
        <div className="steps-row">
          {STEPS.map((step, i) => (
            <div key={step.num} className="step" data-first={i === 0}>
              <div className="step-icon">{step.icon}</div>
              <div>
                <div className="step-num">{step.num}</div>
                <div className="step-label">{step.label}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Footer ── */}
      <footer style={{ flexShrink: 0, background: '#0d0d0d', borderTop: '1px solid rgba(255,255,255,0.08)', padding: '8px 20px', display: 'flex', justifyContent: 'flex-end' }}>
        <a
          href="https://signyl.gg"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'rgba(255,255,255,0.6)', textDecoration: 'none', fontSize: 10, fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase' }}
        >
          Powered by <span style={{ color: '#f97316' }}>Signyl</span>
        </a>
      </footer>

      <style jsx>{`
        .steps-strip {
          flex-shrink: 0;
          background: #fff;
          border-top: 2px solid #f3f4f6;
          padding: 20px 40px 22px;
        }
        .steps-row {
          display: flex;
          max-width: 780px;
          margin: 0 auto;
          align-items: center;
        }
        .step {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 0 20px;
          border-left: 1px solid #f3f4f6;
        }
        .step[data-first='true'] { border-left: none; }
        .step-icon {
          width: 52px;
          height: 52px;
          flex-shrink: 0;
          border-radius: 50%;
          background: #fff7ed;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
          border: 2px solid #fed7aa;
        }
        .step-num {
          font-family: var(--font-fredoka, Fredoka, sans-serif);
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 2px;
          text-transform: uppercase;
          color: #f97316;
          margin-bottom: 2px;
        }
        .step-label {
          font-size: 14px;
          font-weight: 700;
          color: #374151;
          line-height: 1.2;
        }

        /* Tablet — tighten horizontal padding */
        @media (max-width: 768px) {
          .steps-strip { padding: 16px 16px 18px; }
          .step { padding: 0 10px; gap: 10px; }
          .step-icon { width: 44px; height: 44px; font-size: 20px; }
          .step-label { font-size: 12px; }
        }

        /* Phone — stack vertically, left-aligned rows */
        @media (max-width: 520px) {
          .steps-strip { padding: 14px 18px; }
          .steps-row { flex-direction: column; gap: 10px; }
          .step {
            width: 100%;
            padding: 0;
            border-left: none !important;
            gap: 12px;
          }
          .step-icon { width: 40px; height: 40px; font-size: 20px; }
          .step-num { font-size: 9px; letter-spacing: 1.5px; }
          .step-label { font-size: 13px; }
        }
      `}</style>
    </div>
  )
}

function GoogleSVG() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}

function EmailSVG() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#c2410c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2"/>
      <path d="m2 7 10 7 10-7"/>
    </svg>
  )
}
