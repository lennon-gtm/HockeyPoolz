# Landing Page Design Spec

## Overview

Replace the minimal login page with a full-screen branded landing page. Single viewport — no scroll. Serves both new users (first impression) and returning users (quick re-entry).

---

## Visual Style

Matches le Doral (ledoral.com) aesthetic:

- **Fonts:** Fredoka (headings, logo, step labels) + Nunito (body, buttons, eyebrow) — loaded from Google Fonts
- **Background:** Full-bleed hero image (`hero-bg.jpg`) from the le Doral banner, `object-fit: cover`, anchored top-center
- **Overlay:** Left-to-right gradient fading from `rgba(255,250,245,0.93)` at 0% to fully transparent at ~72%, making text readable without obscuring the right-side image content
- **Accent color:** `#f97316` (orange) — replaces le Doral's teal throughout
- **Background base color:** `#fffaf5` (warm off-white)

---

## Layout

The page is a single `100vh` flex column, `overflow: hidden`. No scroll.

```
┌─────────────────────────────────────────────────┐
│ header (absolute, floats over hero)             │
│  logo: HockeyPoolz          nav: How it works   │
├─────────────────────────────────────────────────┤
│                                                 │
│  hero (flex: 1)                                 │
│  ┌──────────────────────┐  ┌──────────────────┐ │
│  │ eyebrow (shield+text)│  │                  │ │
│  │ heading              │  │  hero image      │ │
│  │ subtext              │  │  (girl, right)   │ │
│  │ auth buttons         │  │                  │ │
│  └──────────────────────┘  └──────────────────┘ │
│                                                 │
├─────────────────────────────────────────────────┤
│ steps strip (flex-shrink: 0)                    │
│  🏒 Step 1  │  🧊 Step 2  │  🏆 Step 3         │
└─────────────────────────────────────────────────┘
```

---

## Content

### Header (absolute, z-index: 10)
- **Logo:** "HockeyPoolz" in Fredoka 26px, white with text-shadow
- **Nav:** "How it works" link (scrolls to steps strip — same page, just anchor) + "Sign In" (no-op, page IS sign-in)

### Eyebrow
- BCHL shield image (`/nhl-shield.png`) at 28×32px
- Text: "BCHL Inaugural Playoff Pool" — Nunito 11px, 800 weight, 2.5px letter-spacing, uppercase, orange

### Heading
- Fredoka, ~58px, `line-height: 1.08`, dark `#1a1a1a`
- Line 1: "Your Pool."
- Line 2: "Your Players."
- Line 3: "Your Nonna." — "Nonna." in amber-gold `#d4a017`

### Subtext
- "Pick your NHL playoff roster, compete with friends, and track every goal live."
- Nunito 15px, weight 500, `#555`

### Auth Buttons
Two states: **idle** and **email**.

**Idle state** (default):
1. **Continue with Google** — white pill button, Google logo SVG, dark text, drop shadow
2. **"or" divider** — horizontal rule with centered text
3. **Continue with Email** — warm orange-tinted pill, envelope icon, `#c2410c` text, `#fed7aa` border

**Email state** (after clicking Continue with Email):
- Slide in (or swap) to show:
  - Email input field
  - Password input field
  - **Sign In** submit button (orange, full-width pill)
  - **← Back** text link to return to idle state
  - Error message area (wrong password, user not found, etc.)

### How It Works Strip
Horizontal row of 3 steps, pinned to bottom, white background, `border-top: 2px solid #f3f4f6`:

| Step | Icon | Label |
|------|------|-------|
| Step 1 | 🏒 | Join or create a pool |
| Step 2 | 🧊 | Draft your playoff roster |
| Step 3 | 🏆 | Track every goal live |

Each step: icon in a 52px orange-tinted circle, step number in Fredoka orange uppercase, label in Nunito 14px bold. Steps separated by `1px #f3f4f6` vertical dividers.

---

## Auth Implementation

### Google
`signInWithPopup(auth, googleProvider)` — already wired up in current login page, reuse exact same logic.

### Email / Password
`signInWithEmailAndPassword(auth, email, password)` from Firebase Auth.

**Error handling:**
- `auth/user-not-found` or `auth/invalid-credential` → "No account found with that email."
- `auth/wrong-password` → "Incorrect password."
- `auth/too-many-requests` → "Too many attempts. Try again later."
- Generic fallback → "Something went wrong. Please try again."

No registration flow — email/password accounts are created manually or via admin for now (alpha). Users who don't have an account use Google.

---

## Assets

| File | Source | Notes |
|------|--------|-------|
| `public/nhl-shield.png` | `05_NHL_Shield.svg.png` (project root) | Copy and rename |
| `public/hero-bg.jpg` | Download from le Doral CDN | Self-host; do not rely on 3rd-party CDN in production |

---

## Files Changed

| File | Action |
|------|--------|
| `app/layout.tsx` | Add Fredoka + Nunito Google Fonts link |
| `app/(auth)/login/page.tsx` | Full rebuild — new landing page design |
| `public/nhl-shield.png` | New — copy from `05_NHL_Shield.svg.png` |
| `public/hero-bg.jpg` | New — download hero image |

No schema changes. No new API routes. No changes to `app/(app)/` routes.

---

## Out of Scope

- Mobile responsive layout (desktop-first for alpha)
- User registration via email (manual/admin only for now)
- Password reset flow
- Animations / page transitions
