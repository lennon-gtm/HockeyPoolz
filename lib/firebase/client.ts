import { initializeApp, getApps, getApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
}

// Defer Firebase init to the browser. During server-side prerender,
// NEXT_PUBLIC_* env vars may be absent (e.g. Vercel preview builds),
// and initializeApp would throw auth/invalid-api-key.
export const auth: Auth = typeof window === 'undefined'
  ? ({ currentUser: null } as unknown as Auth)
  : getAuth(getApps().length ? getApp() : initializeApp(firebaseConfig))
