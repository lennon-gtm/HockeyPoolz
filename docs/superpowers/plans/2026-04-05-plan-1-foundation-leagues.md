# HockeyPoolz Plan 1: Foundation + League Management

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Working Next.js app deployed to Vercel — users can sign in with Google/Apple, complete onboarding (team name, icon, NHL team picker), create leagues, configure scoring, and join via invite link.

**Architecture:** Next.js App Router with Firebase Auth for identity and Neon PostgreSQL (via Prisma) for all game data. Auth is stateless — every API route verifies a Firebase ID token. The NHL team color data is seeded once at setup and drives per-user dashboard theming.

**Tech Stack:** Next.js 14+, TypeScript, Tailwind CSS, Prisma, Neon PostgreSQL, Firebase Auth (client + admin SDKs), Vitest

---

## File Structure

```
hockeypoolz/
├── app/
│   ├── (auth)/login/page.tsx          # Google/Apple sign-in page
│   ├── (app)/
│   │   ├── layout.tsx                  # Auth guard + user context
│   │   ├── onboarding/page.tsx         # Team name → icon → NHL team picker
│   │   ├── page.tsx                    # Home (standings placeholder)
│   │   ├── league/
│   │   │   ├── create/page.tsx         # Commissioner creates league
│   │   │   └── [id]/
│   │   │       ├── page.tsx            # League lobby
│   │   │       └── settings/page.tsx   # Scoring settings (commissioner only)
│   │   └── join/[code]/page.tsx        # Join via invite link
│   └── api/
│       ├── auth/me/route.ts            # POST: upsert user on first login
│       ├── leagues/
│       │   ├── route.ts                # POST: create league
│       │   └── [id]/
│       │       ├── route.ts            # GET: league details
│       │       ├── join/route.ts       # POST: join league via invite code
│       │       └── scoring/route.ts    # GET + PUT: scoring settings
│       └── nhl-teams/route.ts          # GET: all 32 teams with colors
├── lib/
│   ├── firebase/
│   │   ├── client.ts                   # Firebase client SDK init (browser)
│   │   └── admin.ts                    # Firebase Admin SDK init (server)
│   ├── prisma.ts                       # Prisma client singleton
│   ├── auth.ts                         # verifyIdToken + requireAuth helpers
│   └── nhl-teams-data.ts               # All 32 teams with colors + divisions
├── prisma/
│   ├── schema.prisma
│   └── seed.ts                         # Seeds nhl_teams table
├── middleware.ts                        # Redirects unauthenticated users
├── __tests__/
│   └── lib/
│       ├── auth.test.ts
│       └── nhl-teams-data.test.ts
└── vitest.config.ts
```

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `tailwind.config.ts`, `vitest.config.ts`, `.env.local.example`

- [ ] **Step 1: Bootstrap Next.js project**

```bash
cd C:/Users/Lenno/Projects/HockeyPoolz
npx create-next-app@latest . --typescript --tailwind --eslint --app --no-src-dir --import-alias "@/*"
```

- [ ] **Step 2: Install dependencies**

```bash
npm install prisma @prisma/client firebase firebase-admin @anthropic-ai/sdk nanoid
npm install -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom
```

- [ ] **Step 3: Configure Vitest**

Create `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
})
```

Create `vitest.setup.ts`:
```typescript
import '@testing-library/jest-dom'
```

- [ ] **Step 4: Create `.env.local.example`**

```bash
# Neon PostgreSQL
DATABASE_URL=postgresql://user:pass@host/hockeypoolz?sslmode=require

# Firebase (client)
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=

# Firebase (admin — server only)
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=

# Claude API
ANTHROPIC_API_KEY=

# Cron security
CRON_SECRET=
```

- [ ] **Step 5: Add test script to package.json**

In `package.json`, ensure scripts include:
```json
"test": "vitest",
"test:run": "vitest run"
```

- [ ] **Step 6: Verify scaffold runs**

```bash
npm run dev
```
Expected: Next.js dev server starts on http://localhost:3000

- [ ] **Step 7: Commit**

```bash
git init
git add .
git commit -m "feat: scaffold Next.js project with Tailwind and Vitest"
```

---

## Task 2: Prisma Schema + Neon Database

**Files:**
- Create: `prisma/schema.prisma`
- Create: `prisma/seed.ts`
- Create: `lib/prisma.ts`

- [ ] **Step 1: Initialize Prisma**

```bash
npx prisma init --datasource-provider postgresql
```

- [ ] **Step 2: Write the full schema**

Replace `prisma/schema.prisma` with:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}

model User {
  id              String    @id @default(uuid())
  firebaseUid     String    @unique @map("firebase_uid")
  email           String    @unique
  displayName     String    @map("display_name")
  avatarUrl       String?   @map("avatar_url")
  favoriteTeamId  String?   @map("favorite_nhl_team_id")
  isPlatformAdmin Boolean   @default(false) @map("is_platform_admin")
  isBanned        Boolean   @default(false) @map("is_banned")
  banType         BanType?  @map("ban_type")
  createdAt       DateTime  @default(now()) @map("created_at")

  favoriteTeam         NhlTeam?       @relation(fields: [favoriteTeamId], references: [id])
  leagueMembers        LeagueMember[]
  commissionedLeagues  League[]       @relation("Commissioner")
  recaps               Recap[]

  @@map("users")
}

enum BanType {
  soft
  hard
}

model League {
  id             String       @id @default(uuid())
  commissionerId String       @map("commissioner_id")
  name           String
  inviteCode     String       @unique @map("invite_code")
  status         LeagueStatus @default(setup)
  maxTeams       Int          @map("max_teams")
  playersPerTeam Int          @default(10) @map("players_per_team")
  createdAt      DateTime     @default(now()) @map("created_at")

  commissioner    User             @relation("Commissioner", fields: [commissionerId], references: [id])
  members         LeagueMember[]
  scoringSettings ScoringSettings?
  draft           Draft?
  recaps          Recap[]

  @@map("leagues")
}

enum LeagueStatus {
  setup
  draft
  active
  complete
  frozen
}

model LeagueMember {
  id                String            @id @default(uuid())
  leagueId          String            @map("league_id")
  userId            String            @map("user_id")
  teamName          String            @map("team_name")
  teamIcon          String?           @map("team_icon")
  draftPosition     Int?              @map("draft_position")
  autodraftEnabled  Boolean           @default(false) @map("autodraft_enabled")
  autodraftStrategy AutodraftStrategy @default(adp) @map("autodraft_strategy")
  totalScore        Decimal           @default(0) @db.Decimal(10, 2) @map("total_score")
  joinedAt          DateTime          @default(now()) @map("joined_at")

  league      League             @relation(fields: [leagueId], references: [id])
  user        User               @relation(fields: [userId], references: [id])
  draftPicks  DraftPick[]
  wishlist    AutodraftWishlist[]
  recaps      Recap[]

  @@unique([leagueId, userId])
  @@map("league_members")
}

enum AutodraftStrategy {
  adp
  wishlist
}

model ScoringSettings {
  id          String  @id @default(uuid())
  leagueId    String  @unique @map("league_id")
  goals       Decimal @default(2.0) @db.Decimal(5, 2)
  assists     Decimal @default(1.5) @db.Decimal(5, 2)
  plusMinus   Decimal @default(0.5) @db.Decimal(5, 2) @map("plus_minus")
  pim         Decimal @default(0.0) @db.Decimal(5, 2)
  shots       Decimal @default(0.1) @db.Decimal(5, 2)
  goalieWins  Decimal @default(3.0) @db.Decimal(5, 2) @map("goalie_wins")
  goalieSaves Decimal @default(0.2) @db.Decimal(5, 2) @map("goalie_saves")
  shutouts    Decimal @default(5.0) @db.Decimal(5, 2)

  league League @relation(fields: [leagueId], references: [id])

  @@map("scoring_settings")
}

model Draft {
  id                String      @id @default(uuid())
  leagueId          String      @unique @map("league_id")
  status            DraftStatus @default(pending)
  currentPickNumber Int         @default(1) @map("current_pick_number")
  pickTimeLimitSecs Int         @default(90) @map("pick_time_limit_secs")
  isMock            Boolean     @default(false) @map("is_mock")
  startedAt         DateTime?   @map("started_at")

  league League      @relation(fields: [leagueId], references: [id])
  picks  DraftPick[]

  @@map("drafts")
}

enum DraftStatus {
  pending
  active
  paused
  complete
}

model DraftPick {
  id             String   @id @default(uuid())
  draftId        String   @map("draft_id")
  leagueMemberId String   @map("league_member_id")
  playerId       Int      @map("player_id")
  round          Int
  pickNumber     Int      @map("pick_number")
  isAutoPick     Boolean  @default(false) @map("is_auto_pick")
  isAutodraft    Boolean  @default(false) @map("is_autodraft")
  pickedAt       DateTime @default(now()) @map("picked_at")

  draft        Draft        @relation(fields: [draftId], references: [id])
  leagueMember LeagueMember @relation(fields: [leagueMemberId], references: [id])
  player       NhlPlayer    @relation(fields: [playerId], references: [id])

  @@map("draft_picks")
}

model AutodraftWishlist {
  id             String @id @default(uuid())
  leagueMemberId String @map("league_member_id")
  playerId       Int    @map("player_id")
  rank           Int

  leagueMember LeagueMember @relation(fields: [leagueMemberId], references: [id])
  player       NhlPlayer    @relation(fields: [playerId], references: [id])

  @@unique([leagueMemberId, playerId])
  @@unique([leagueMemberId, rank])
  @@map("autodraft_wishlist")
}

model Recap {
  id             String   @id @default(uuid())
  leagueId       String   @map("league_id")
  leagueMemberId String   @map("league_member_id")
  recapDate      DateTime @db.Date @map("recap_date")
  content        String
  standingChange Int      @map("standing_change")
  createdAt      DateTime @default(now()) @map("created_at")

  league       League       @relation(fields: [leagueId], references: [id])
  leagueMember LeagueMember @relation(fields: [leagueMemberId], references: [id])

  @@map("recaps")
}

// StatsService tables — never written by app logic, only by StatsService
model NhlTeam {
  id             String     @id
  name           String
  city           String
  abbreviation   String
  logoUrl        String?    @map("logo_url")
  conference     Conference
  division       String
  colorPrimary   String     @map("color_primary")
  colorSecondary String     @map("color_secondary")
  eliminatedAt   DateTime?  @map("eliminated_at")

  players NhlPlayer[]
  users   User[]

  @@map("nhl_teams")
}

enum Conference {
  east
  west
}

model NhlPlayer {
  id          Int       @id
  teamId      String    @map("team_id")
  name        String
  position    Position
  headshotUrl String?   @map("headshot_url")
  adp         Decimal?  @db.Decimal(6, 2)

  team            NhlTeam            @relation(fields: [teamId], references: [id])
  gameStats       PlayerGameStats[]
  draftPicks      DraftPick[]
  wishlistEntries AutodraftWishlist[]

  @@map("nhl_players")
}

enum Position {
  C
  LW
  RW
  D
  G
}

model PlayerGameStats {
  id           String   @id @default(uuid())
  playerId     Int      @map("player_id")
  gameId       String   @map("game_id")
  gameDate     DateTime @db.Date @map("game_date")
  goals        Int      @default(0)
  assists      Int      @default(0)
  plusMinus    Int      @default(0) @map("plus_minus")
  pim          Int      @default(0)
  shots        Int      @default(0)
  goalieWins   Int      @default(0) @map("goalie_wins")
  goalieSaves  Int      @default(0) @map("goalie_saves")
  goalsAgainst Int      @default(0) @map("goals_against")
  shutouts     Int      @default(0)

  player NhlPlayer @relation(fields: [playerId], references: [id])

  @@unique([playerId, gameId])
  @@map("player_game_stats")
}
```

- [ ] **Step 3: Create Prisma client singleton**

Create `lib/prisma.ts`:
```typescript
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({ log: process.env.NODE_ENV === 'development' ? ['query'] : [] })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

- [ ] **Step 4: Set up Neon database**

Go to neon.tech, create a project named `hockeypoolz`. Copy the connection strings into `.env.local`:
```
DATABASE_URL=postgresql://...?sslmode=require&pgbouncer=true
DIRECT_URL=postgresql://...?sslmode=require
```
(Neon provides both — `DATABASE_URL` uses the pooler, `DIRECT_URL` is for migrations)

- [ ] **Step 5: Run migration**

```bash
npx prisma migrate dev --name init
```
Expected: Migration created in `prisma/migrations/`, tables created in Neon.

- [ ] **Step 6: Commit**

```bash
git add prisma/ lib/prisma.ts
git commit -m "feat: add Prisma schema and Neon connection"
```

---

## Task 3: NHL Team Data + Seed

**Files:**
- Create: `lib/nhl-teams-data.ts`
- Create: `prisma/seed.ts`
- Test: `__tests__/lib/nhl-teams-data.test.ts`

- [ ] **Step 1: Write failing test**

Create `__tests__/lib/nhl-teams-data.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { NHL_TEAMS } from '@/lib/nhl-teams-data'

describe('NHL_TEAMS', () => {
  it('contains all 32 teams', () => {
    expect(NHL_TEAMS).toHaveLength(32)
  })

  it('every team has required fields', () => {
    for (const team of NHL_TEAMS) {
      expect(team.id).toBeTruthy()
      expect(team.name).toBeTruthy()
      expect(team.city).toBeTruthy()
      expect(team.colorPrimary).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(team.colorSecondary).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(['east', 'west']).toContain(team.conference)
      expect(team.division).toBeTruthy()
    }
  })

  it('each conference has exactly 16 teams', () => {
    const east = NHL_TEAMS.filter(t => t.conference === 'east')
    const west = NHL_TEAMS.filter(t => t.conference === 'west')
    expect(east).toHaveLength(16)
    expect(west).toHaveLength(16)
  })

  it('team IDs are unique', () => {
    const ids = NHL_TEAMS.map(t => t.id)
    expect(new Set(ids).size).toBe(32)
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm run test:run -- __tests__/lib/nhl-teams-data.test.ts
```
Expected: FAIL — `Cannot find module '@/lib/nhl-teams-data'`

- [ ] **Step 3: Create the team data**

Create `lib/nhl-teams-data.ts`:
```typescript
export interface NhlTeamData {
  id: string
  name: string
  city: string
  abbreviation: string
  conference: 'east' | 'west'
  division: string
  colorPrimary: string
  colorSecondary: string
}

export const NHL_TEAMS: NhlTeamData[] = [
  // Eastern — Atlantic
  { id: 'BOS', name: 'Bruins',       city: 'Boston',      abbreviation: 'BOS', conference: 'east', division: 'Atlantic',     colorPrimary: '#FFB81C', colorSecondary: '#010101' },
  { id: 'BUF', name: 'Sabres',       city: 'Buffalo',     abbreviation: 'BUF', conference: 'east', division: 'Atlantic',     colorPrimary: '#002654', colorSecondary: '#FCB514' },
  { id: 'DET', name: 'Red Wings',    city: 'Detroit',     abbreviation: 'DET', conference: 'east', division: 'Atlantic',     colorPrimary: '#CE1126', colorSecondary: '#FFFFFF' },
  { id: 'FLA', name: 'Panthers',     city: 'Florida',     abbreviation: 'FLA', conference: 'east', division: 'Atlantic',     colorPrimary: '#041E42', colorSecondary: '#C8102E' },
  { id: 'MTL', name: 'Canadiens',    city: 'Montréal',    abbreviation: 'MTL', conference: 'east', division: 'Atlantic',     colorPrimary: '#AF1E2D', colorSecondary: '#192168' },
  { id: 'OTT', name: 'Senators',     city: 'Ottawa',      abbreviation: 'OTT', conference: 'east', division: 'Atlantic',     colorPrimary: '#C8102E', colorSecondary: '#C69214' },
  { id: 'TBL', name: 'Lightning',    city: 'Tampa Bay',   abbreviation: 'TBL', conference: 'east', division: 'Atlantic',     colorPrimary: '#002868', colorSecondary: '#FFFFFF' },
  { id: 'TOR', name: 'Maple Leafs',  city: 'Toronto',     abbreviation: 'TOR', conference: 'east', division: 'Atlantic',     colorPrimary: '#00205B', colorSecondary: '#FFFFFF' },
  // Eastern — Metropolitan
  { id: 'CAR', name: 'Hurricanes',   city: 'Carolina',    abbreviation: 'CAR', conference: 'east', division: 'Metropolitan', colorPrimary: '#CC0000', colorSecondary: '#000000' },
  { id: 'CBJ', name: 'Blue Jackets', city: 'Columbus',    abbreviation: 'CBJ', conference: 'east', division: 'Metropolitan', colorPrimary: '#002654', colorSecondary: '#CE1126' },
  { id: 'NJD', name: 'Devils',       city: 'New Jersey',  abbreviation: 'NJD', conference: 'east', division: 'Metropolitan', colorPrimary: '#CE1126', colorSecondary: '#003366' },
  { id: 'NYI', name: 'Islanders',    city: 'New York',    abbreviation: 'NYI', conference: 'east', division: 'Metropolitan', colorPrimary: '#00539B', colorSecondary: '#F47D30' },
  { id: 'NYR', name: 'Rangers',      city: 'New York',    abbreviation: 'NYR', conference: 'east', division: 'Metropolitan', colorPrimary: '#0038A8', colorSecondary: '#CE1126' },
  { id: 'PHI', name: 'Flyers',       city: 'Philadelphia',abbreviation: 'PHI', conference: 'east', division: 'Metropolitan', colorPrimary: '#F74902', colorSecondary: '#000000' },
  { id: 'PIT', name: 'Penguins',     city: 'Pittsburgh',  abbreviation: 'PIT', conference: 'east', division: 'Metropolitan', colorPrimary: '#FCB514', colorSecondary: '#000000' },
  { id: 'WSH', name: 'Capitals',     city: 'Washington',  abbreviation: 'WSH', conference: 'east', division: 'Metropolitan', colorPrimary: '#041E42', colorSecondary: '#C8102E' },
  // Western — Central
  { id: 'CHI', name: 'Blackhawks',   city: 'Chicago',     abbreviation: 'CHI', conference: 'west', division: 'Central',      colorPrimary: '#CF0A2C', colorSecondary: '#FF671B' },
  { id: 'COL', name: 'Avalanche',    city: 'Colorado',    abbreviation: 'COL', conference: 'west', division: 'Central',      colorPrimary: '#6F263D', colorSecondary: '#236192' },
  { id: 'DAL', name: 'Stars',        city: 'Dallas',      abbreviation: 'DAL', conference: 'west', division: 'Central',      colorPrimary: '#006847', colorSecondary: '#8F8F8C' },
  { id: 'MIN', name: 'Wild',         city: 'Minnesota',   abbreviation: 'MIN', conference: 'west', division: 'Central',      colorPrimary: '#154734', colorSecondary: '#A6192E' },
  { id: 'NSH', name: 'Predators',    city: 'Nashville',   abbreviation: 'NSH', conference: 'west', division: 'Central',      colorPrimary: '#FFB81C', colorSecondary: '#041E42' },
  { id: 'STL', name: 'Blues',        city: 'St. Louis',   abbreviation: 'STL', conference: 'west', division: 'Central',      colorPrimary: '#002F87', colorSecondary: '#FCB514' },
  { id: 'UTA', name: 'Hockey Club',  city: 'Utah',        abbreviation: 'UTA', conference: 'west', division: 'Central',      colorPrimary: '#6CACE4', colorSecondary: '#010101' },
  { id: 'WPG', name: 'Jets',         city: 'Winnipeg',    abbreviation: 'WPG', conference: 'west', division: 'Central',      colorPrimary: '#041E42', colorSecondary: '#004C97' },
  // Western — Pacific
  { id: 'ANA', name: 'Ducks',        city: 'Anaheim',     abbreviation: 'ANA', conference: 'west', division: 'Pacific',      colorPrimary: '#F47A38', colorSecondary: '#B09865' },
  { id: 'CGY', name: 'Flames',       city: 'Calgary',     abbreviation: 'CGY', conference: 'west', division: 'Pacific',      colorPrimary: '#C8102E', colorSecondary: '#F1BE48' },
  { id: 'EDM', name: 'Oilers',       city: 'Edmonton',    abbreviation: 'EDM', conference: 'west', division: 'Pacific',      colorPrimary: '#FF4C00', colorSecondary: '#003087' },
  { id: 'LAK', name: 'Kings',        city: 'Los Angeles', abbreviation: 'LAK', conference: 'west', division: 'Pacific',      colorPrimary: '#111111', colorSecondary: '#A2AAAD' },
  { id: 'SJS', name: 'Sharks',       city: 'San Jose',    abbreviation: 'SJS', conference: 'west', division: 'Pacific',      colorPrimary: '#006D75', colorSecondary: '#EA7200' },
  { id: 'SEA', name: 'Kraken',       city: 'Seattle',     abbreviation: 'SEA', conference: 'west', division: 'Pacific',      colorPrimary: '#001628', colorSecondary: '#99D9D9' },
  { id: 'VAN', name: 'Canucks',      city: 'Vancouver',   abbreviation: 'VAN', conference: 'west', division: 'Pacific',      colorPrimary: '#00205B', colorSecondary: '#00843D' },
  { id: 'VGK', name: 'Golden Knights',city: 'Vegas',      abbreviation: 'VGK', conference: 'west', division: 'Pacific',      colorPrimary: '#B4975A', colorSecondary: '#333F42' },
]
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
npm run test:run -- __tests__/lib/nhl-teams-data.test.ts
```
Expected: PASS (4 tests)

- [ ] **Step 5: Create seed script**

Add to `package.json` scripts:
```json
"db:seed": "npx ts-node --compiler-options '{\"module\":\"CommonJS\"}' prisma/seed.ts"
```

Add to `package.json` at root level:
```json
"prisma": {
  "seed": "npx ts-node --compiler-options {\"module\":\"CommonJS\"} prisma/seed.ts"
}
```

Create `prisma/seed.ts`:
```typescript
import { PrismaClient } from '@prisma/client'
import { NHL_TEAMS } from '../lib/nhl-teams-data'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding NHL teams...')
  for (const team of NHL_TEAMS) {
    await prisma.nhlTeam.upsert({
      where: { id: team.id },
      update: {
        name: team.name,
        city: team.city,
        abbreviation: team.abbreviation,
        conference: team.conference,
        division: team.division,
        colorPrimary: team.colorPrimary,
        colorSecondary: team.colorSecondary,
      },
      create: {
        id: team.id,
        name: team.name,
        city: team.city,
        abbreviation: team.abbreviation,
        conference: team.conference,
        division: team.division,
        colorPrimary: team.colorPrimary,
        colorSecondary: team.colorSecondary,
      },
    })
  }
  console.log(`Seeded ${NHL_TEAMS.length} teams.`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
```

- [ ] **Step 6: Run seed**

```bash
npx prisma db seed
```
Expected: `Seeded 32 teams.`

- [ ] **Step 7: Commit**

```bash
git add lib/nhl-teams-data.ts prisma/seed.ts __tests__/lib/nhl-teams-data.test.ts
git commit -m "feat: add NHL team data with colors and seed script"
```

---

## Task 4: Firebase Auth Integration

**Files:**
- Create: `lib/firebase/client.ts`
- Create: `lib/firebase/admin.ts`
- Create: `lib/auth.ts`
- Test: `__tests__/lib/auth.test.ts`

- [ ] **Step 1: Write failing test**

Create `__tests__/lib/auth.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Firebase Admin before importing auth
vi.mock('@/lib/firebase/admin', () => ({
  adminAuth: {
    verifyIdToken: vi.fn(),
  },
}))

import { verifyIdToken, AuthError } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase/admin'

describe('verifyIdToken', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns decoded token for a valid token', async () => {
    const mockDecoded = { uid: 'user-123', email: 'test@example.com' }
    vi.mocked(adminAuth.verifyIdToken).mockResolvedValue(mockDecoded as any)

    const result = await verifyIdToken('valid-token')
    expect(result).toEqual(mockDecoded)
    expect(adminAuth.verifyIdToken).toHaveBeenCalledWith('valid-token')
  })

  it('throws AuthError when token is missing', async () => {
    await expect(verifyIdToken('')).rejects.toThrow(AuthError)
    await expect(verifyIdToken('')).rejects.toThrow('No token provided')
  })

  it('throws AuthError when Firebase rejects the token', async () => {
    vi.mocked(adminAuth.verifyIdToken).mockRejectedValue(new Error('Token expired'))
    await expect(verifyIdToken('bad-token')).rejects.toThrow(AuthError)
    await expect(verifyIdToken('bad-token')).rejects.toThrow('Invalid token')
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm run test:run -- __tests__/lib/auth.test.ts
```
Expected: FAIL — modules not found

- [ ] **Step 3: Create Firebase client SDK init**

Create `lib/firebase/client.ts`:
```typescript
import { initializeApp, getApps, getApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
}

const app = getApps().length ? getApp() : initializeApp(firebaseConfig)
export const auth = getAuth(app)
```

- [ ] **Step 4: Create Firebase Admin SDK init**

Create `lib/firebase/admin.ts`:
```typescript
import { initializeApp, getApps, cert, App } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

function getAdminApp(): App {
  if (getApps().length > 0) return getApps()[0]
  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID!,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
      privateKey: process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
    }),
  })
}

export const adminAuth = getAuth(getAdminApp())
```

- [ ] **Step 5: Create auth helper**

Create `lib/auth.ts`:
```typescript
import { adminAuth } from '@/lib/firebase/admin'
import type { DecodedIdToken } from 'firebase-admin/auth'

export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

export async function verifyIdToken(token: string): Promise<DecodedIdToken> {
  if (!token) throw new AuthError('No token provided')
  try {
    return await adminAuth.verifyIdToken(token)
  } catch {
    throw new AuthError('Invalid token')
  }
}

export function getBearerToken(authHeader: string | null): string {
  if (!authHeader?.startsWith('Bearer ')) return ''
  return authHeader.slice(7)
}
```

- [ ] **Step 6: Run test to confirm it passes**

```bash
npm run test:run -- __tests__/lib/auth.test.ts
```
Expected: PASS (3 tests)

- [ ] **Step 7: Commit**

```bash
git add lib/firebase/ lib/auth.ts __tests__/lib/auth.test.ts
git commit -m "feat: add Firebase Auth client, admin SDK, and verifyIdToken helper"
```

---

## Task 5: Auth Middleware + User Creation API

**Files:**
- Create: `middleware.ts`
- Create: `app/api/auth/me/route.ts`

- [ ] **Step 1: Create Next.js middleware**

Create `middleware.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server'

const PUBLIC_PATHS = ['/login', '/join', '/api/auth/me']

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isPublic = PUBLIC_PATHS.some(p => pathname.startsWith(p))
  if (isPublic) return NextResponse.next()

  // API routes: check Authorization header
  if (pathname.startsWith('/api/')) {
    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.next()
  }

  // Pages: check session cookie (set by client after Firebase login)
  const session = request.cookies.get('session')
  if (!session) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

- [ ] **Step 2: Create user upsert API route**

Create `app/api/auth/me/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest) {
  try {
    const token = getBearerToken(request.headers.get('authorization'))
    const decoded = await verifyIdToken(token)

    const user = await prisma.user.upsert({
      where: { firebaseUid: decoded.uid },
      update: { email: decoded.email ?? '' },
      create: {
        firebaseUid: decoded.uid,
        email: decoded.email ?? '',
        displayName: decoded.name ?? decoded.email?.split('@')[0] ?? 'Player',
        avatarUrl: decoded.picture ?? null,
      },
    })

    const needsOnboarding = !user.favoriteTeamId

    return NextResponse.json({ user, needsOnboarding })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 })
    }
    console.error('POST /api/auth/me error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const token = getBearerToken(request.headers.get('authorization'))
    const decoded = await verifyIdToken(token)

    const user = await prisma.user.findUnique({
      where: { firebaseUid: decoded.uid },
      include: { favoriteTeam: true },
    })

    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    return NextResponse.json({ user })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 3: Create NHL teams API route (for team picker)**

Create `app/api/nhl-teams/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const teams = await prisma.nhlTeam.findMany({
    orderBy: [{ conference: 'asc' }, { division: 'asc' }, { city: 'asc' }],
  })
  return NextResponse.json({ teams })
}
```

- [ ] **Step 4: Manual test**

Start dev server and test with curl:
```bash
npm run dev
# In another terminal:
curl -X POST http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer invalid-token"
```
Expected: `{"error":"Invalid token"}` with 401 status

```bash
curl http://localhost:3000/api/nhl-teams
```
Expected: JSON array of 32 teams

- [ ] **Step 5: Commit**

```bash
git add middleware.ts app/api/auth/ app/api/nhl-teams/
git commit -m "feat: add auth middleware and user upsert API"
```

---

## Task 6: League Creation + Invite API

**Files:**
- Create: `app/api/leagues/route.ts`
- Create: `app/api/leagues/[id]/route.ts`
- Create: `app/api/leagues/[id]/join/route.ts`

- [ ] **Step 1: Install nanoid for invite codes**

```bash
npm install nanoid
```

- [ ] **Step 2: Create league creation API**

Create `app/api/leagues/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { nanoid } from 'nanoid'

export async function POST(request: NextRequest) {
  try {
    const token = getBearerToken(request.headers.get('authorization'))
    const decoded = await verifyIdToken(token)

    const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
    if (user.isBanned) return NextResponse.json({ error: 'Account suspended' }, { status: 403 })

    const body = await request.json()
    const { name, maxTeams, playersPerTeam } = body

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return NextResponse.json({ error: 'League name must be at least 2 characters' }, { status: 400 })
    }
    if (!maxTeams || maxTeams < 2 || maxTeams > 20) {
      return NextResponse.json({ error: 'Max teams must be between 2 and 20' }, { status: 400 })
    }
    if (!playersPerTeam || playersPerTeam < 4 || playersPerTeam > 20) {
      return NextResponse.json({ error: 'Players per team must be between 4 and 20' }, { status: 400 })
    }

    const league = await prisma.league.create({
      data: {
        commissionerId: user.id,
        name: name.trim(),
        inviteCode: nanoid(8),
        maxTeams,
        playersPerTeam,
        scoringSettings: {
          create: {}, // creates with all defaults from schema
        },
      },
      include: { scoringSettings: true },
    })

    // Commissioner auto-joins as first member
    await prisma.leagueMember.create({
      data: {
        leagueId: league.id,
        userId: user.id,
        teamName: user.displayName,
        teamIcon: user.avatarUrl,
      },
    })

    return NextResponse.json({ league }, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('POST /api/leagues error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 3: Create league detail + join API**

Create `app/api/leagues/[id]/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  // League detail is public for invite preview — no auth required
  const league = await prisma.league.findUnique({
    where: { id: params.id },
    include: {
      commissioner: { select: { displayName: true, avatarUrl: true } },
      members: {
        include: { user: { select: { displayName: true, avatarUrl: true } } },
      },
      scoringSettings: true,
    },
  })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  return NextResponse.json({ league })
}
```

Create `app/api/leagues/[id]/join/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const token = getBearerToken(request.headers.get('authorization'))
    const decoded = await verifyIdToken(token)

    const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
    if (user.isBanned) return NextResponse.json({ error: 'Account suspended' }, { status: 403 })

    const { teamName, teamIcon, inviteCode } = await request.json()

    const league = await prisma.league.findUnique({ where: { id: params.id } })
    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
    if (league.inviteCode !== inviteCode) return NextResponse.json({ error: 'Invalid invite code' }, { status: 403 })
    if (league.status !== 'setup') return NextResponse.json({ error: 'League is not accepting new members' }, { status: 400 })

    const memberCount = await prisma.leagueMember.count({ where: { leagueId: league.id } })
    if (memberCount >= league.maxTeams) return NextResponse.json({ error: 'League is full' }, { status: 400 })

    const existing = await prisma.leagueMember.findUnique({
      where: { leagueId_userId: { leagueId: league.id, userId: user.id } },
    })
    if (existing) return NextResponse.json({ error: 'Already a member' }, { status: 400 })

    if (!teamName || teamName.trim().length < 1) {
      return NextResponse.json({ error: 'Team name is required' }, { status: 400 })
    }

    const member = await prisma.leagueMember.create({
      data: {
        leagueId: league.id,
        userId: user.id,
        teamName: teamName.trim(),
        teamIcon: teamIcon ?? null,
      },
    })

    return NextResponse.json({ member }, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('POST /api/leagues/[id]/join error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add app/api/leagues/
git commit -m "feat: add league creation and join API routes"
```

---

## Task 7: Scoring Settings API

**Files:**
- Create: `app/api/leagues/[id]/scoring/route.ts`

- [ ] **Step 1: Create scoring settings API**

Create `app/api/leagues/[id]/scoring/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const settings = await prisma.scoringSettings.findUnique({ where: { leagueId: params.id } })
  if (!settings) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ settings })
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const token = getBearerToken(request.headers.get('authorization'))
    const decoded = await verifyIdToken(token)

    const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const league = await prisma.league.findUnique({ where: { id: params.id } })
    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
    if (league.commissionerId !== user.id) {
      return NextResponse.json({ error: 'Only the commissioner can update scoring settings' }, { status: 403 })
    }
    if (league.status === 'active' || league.status === 'complete') {
      return NextResponse.json({ error: 'Cannot change scoring after the draft' }, { status: 400 })
    }

    const body = await request.json()
    const allowedFields = ['goals', 'assists', 'plusMinus', 'pim', 'shots', 'goalieWins', 'goalieSaves', 'shutouts']
    const updates: Record<string, number> = {}

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        const val = Number(body[field])
        if (isNaN(val) || val < 0 || val > 100) {
          return NextResponse.json({ error: `Invalid value for ${field}` }, { status: 400 })
        }
        updates[field] = val
      }
    }

    const settings = await prisma.scoringSettings.update({
      where: { leagueId: params.id },
      data: updates,
    })

    return NextResponse.json({ settings })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/leagues/
git commit -m "feat: add scoring settings GET and PUT API"
```

---

## Task 8: Onboarding + Login UI

**Files:**
- Create: `app/(auth)/login/page.tsx`
- Create: `app/(app)/onboarding/page.tsx`
- Create: `app/(app)/layout.tsx`

- [ ] **Step 1: Create login page**

Create `app/(auth)/login/page.tsx`:
```tsx
'use client'
import { useState } from 'react'
import { signInWithPopup, GoogleAuthProvider, OAuthProvider } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function signIn(provider: 'google' | 'apple') {
    setLoading(true)
    setError('')
    try {
      const p = provider === 'google'
        ? new GoogleAuthProvider()
        : new OAuthProvider('apple.com')
      const result = await signInWithPopup(auth, p)
      const token = await result.user.getIdToken()

      const res = await fetch('/api/auth/me', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()

      document.cookie = `session=${token}; path=/; max-age=3600; SameSite=Strict`

      if (data.needsOnboarding) {
        router.push('/onboarding')
      } else {
        router.push('/')
      }
    } catch {
      setError('Sign in failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <h1 className="text-3xl font-black tracking-widest text-center mb-2">HOCKEYPOOLZ</h1>
        <p className="text-center text-gray-500 mb-8 text-sm">Sign in to join or create a league</p>
        {error && <p className="text-red-600 text-sm text-center mb-4">{error}</p>}
        <button
          onClick={() => signIn('google')}
          disabled={loading}
          className="w-full mb-3 py-3 px-4 rounded-xl border-2 border-gray-200 font-semibold hover:border-gray-400 transition disabled:opacity-50"
        >
          Continue with Google
        </button>
        <button
          onClick={() => signIn('apple')}
          disabled={loading}
          className="w-full py-3 px-4 rounded-xl bg-black text-white font-semibold hover:bg-gray-900 transition disabled:opacity-50"
        >
          Continue with Apple
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create authenticated layout with user context**

Create `app/(app)/layout.tsx`:
```tsx
'use client'
import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.push('/login')
        return
      }
      const token = await user.getIdToken()
      document.cookie = `session=${token}; path=/; max-age=3600; SameSite=Strict`
      setChecking(false)
    })
    return unsub
  }, [router])

  if (checking) {
    return <div className="min-h-screen bg-white flex items-center justify-center">
      <p className="text-gray-400 text-sm">Loading...</p>
    </div>
  }

  return <>{children}</>
}
```

- [ ] **Step 3: Create onboarding page with team picker**

Create `app/(app)/onboarding/page.tsx`:
```tsx
'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { auth } from '@/lib/firebase/client'

interface NhlTeam {
  id: string; name: string; city: string; abbreviation: string
  conference: string; division: string
  colorPrimary: string; colorSecondary: string
}

type Step = 'team-name' | 'team-icon' | 'nhl-team'

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('team-name')
  const [teamName, setTeamName] = useState('')
  const [teamIcon, setTeamIcon] = useState('🏒')
  const [selectedTeamId, setSelectedTeamId] = useState('')
  const [nhlTeams, setNhlTeams] = useState<NhlTeam[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const EMOJI_OPTIONS = ['🏒', '🦅', '🐺', '⚡', '🔥', '🦁', '🦊', '🐻', '🏆', '🥅']

  useEffect(() => {
    fetch('/api/nhl-teams').then(r => r.json()).then(d => setNhlTeams(d.teams))
  }, [])

  const conferences = ['east', 'west']
  const divisions: Record<string, string[]> = {
    east: ['Atlantic', 'Metropolitan'],
    west: ['Central', 'Pacific'],
  }

  const filteredTeams = (conference: string, division: string) =>
    nhlTeams
      .filter(t => t.conference === conference && t.division === division)
      .filter(t => !search || t.city.toLowerCase().includes(search.toLowerCase()) || t.name.toLowerCase().includes(search.toLowerCase()))

  async function complete() {
    if (!selectedTeamId) { setError('Please select a team'); return }
    setLoading(true)
    try {
      const token = await auth.currentUser?.getIdToken()
      await fetch('/api/auth/me', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ favoriteTeamId: selectedTeamId, displayName: teamName, avatarUrl: teamIcon }),
      })
      router.push('/')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const selectedTeam = nhlTeams.find(t => t.id === selectedTeamId)

  return (
    <div className="min-h-screen bg-white">
      {/* Header — color-reactive */}
      <div
        className="p-5 transition-colors duration-300"
        style={{ backgroundColor: selectedTeam?.colorPrimary ?? '#FF6B00' }}
      >
        <p className="text-white font-black tracking-widest text-lg">HOCKEYPOOLZ</p>
        <p className="text-white/70 text-xs mt-1">
          {step === 'team-name' && 'Step 1 of 3 — Name your team'}
          {step === 'team-icon' && 'Step 2 of 3 — Choose an icon'}
          {step === 'nhl-team' && 'Step 3 of 3 — Pick your favourite NHL team'}
        </p>
        {selectedTeam && (
          <p className="text-white/90 text-sm font-semibold mt-2">✓ {selectedTeam.city} {selectedTeam.name}</p>
        )}
      </div>

      <div className="p-6 max-w-lg mx-auto">
        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

        {step === 'team-name' && (
          <>
            <h2 className="text-xl font-bold mb-1">Name your team</h2>
            <p className="text-gray-500 text-sm mb-6">This is how you'll appear in the league standings.</p>
            <input
              className="w-full border-2 border-gray-200 rounded-xl p-3 text-base focus:border-orange-500 outline-none mb-6"
              placeholder="e.g. BobsTeam"
              value={teamName}
              onChange={e => setTeamName(e.target.value)}
              maxLength={30}
            />
            <button
              onClick={() => { if (teamName.trim().length >= 1) setStep('team-icon'); else setError('Enter a team name') }}
              className="w-full py-3 rounded-xl font-bold text-white bg-orange-500 hover:bg-orange-600 transition"
            >
              Next →
            </button>
          </>
        )}

        {step === 'team-icon' && (
          <>
            <h2 className="text-xl font-bold mb-1">Choose a team icon</h2>
            <p className="text-gray-500 text-sm mb-6">Shows up next to your team name everywhere.</p>
            <div className="grid grid-cols-5 gap-3 mb-6">
              {EMOJI_OPTIONS.map(e => (
                <button
                  key={e}
                  onClick={() => setTeamIcon(e)}
                  className={`text-3xl p-3 rounded-xl border-2 transition ${teamIcon === e ? 'border-orange-500 bg-orange-50' : 'border-gray-200'}`}
                >
                  {e}
                </button>
              ))}
            </div>
            <button
              onClick={() => setStep('nhl-team')}
              className="w-full py-3 rounded-xl font-bold text-white bg-orange-500 hover:bg-orange-600 transition"
            >
              Next →
            </button>
          </>
        )}

        {step === 'nhl-team' && (
          <>
            <h2 className="text-xl font-bold mb-1">Pick your favourite NHL team</h2>
            <p className="text-gray-500 text-sm mb-4">Your dashboard will match their colours all playoff long.</p>
            <input
              className="w-full border-2 border-gray-200 rounded-xl p-3 text-sm focus:border-orange-500 outline-none mb-5"
              placeholder="Search teams…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {conferences.map(conf => (
              <div key={conf} className="mb-5">
                <span className={`text-xs font-bold tracking-widest uppercase text-white px-3 py-1 rounded-md ${conf === 'east' ? 'bg-blue-900' : 'bg-green-800'}`}>
                  {conf === 'east' ? 'Eastern' : 'Western'} Conference
                </span>
                {divisions[conf].map(div => {
                  const teams = filteredTeams(conf, div)
                  if (!teams.length) return null
                  return (
                    <div key={div} className="mt-3">
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 pl-1 border-l-2 border-gray-200 pl-2">{div} Division</p>
                      <div className="grid grid-cols-4 gap-2">
                        {teams.map(team => (
                          <button
                            key={team.id}
                            onClick={() => setSelectedTeamId(team.id)}
                            className={`rounded-xl border-2 p-2 text-center transition ${selectedTeamId === team.id ? 'border-current' : 'border-gray-200'}`}
                            style={selectedTeamId === team.id ? { borderColor: team.colorPrimary, backgroundColor: team.colorPrimary + '10' } : {}}
                          >
                            <div
                              className="w-8 h-8 rounded-full mx-auto mb-1"
                              style={{ background: `linear-gradient(135deg, ${team.colorPrimary}, ${team.colorSecondary})` }}
                            />
                            <p className="text-xs font-semibold leading-tight" style={selectedTeamId === team.id ? { color: team.colorPrimary } : { color: '#444' }}>
                              {team.city}<br />{team.name}
                            </p>
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
            <button
              onClick={complete}
              disabled={loading || !selectedTeamId}
              className="w-full py-3 rounded-xl font-bold text-white transition disabled:opacity-40 mt-4"
              style={{ backgroundColor: selectedTeam?.colorPrimary ?? '#FF6B00' }}
            >
              {loading ? 'Saving…' : 'Enter My League →'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Update auth/me route to handle onboarding profile update**

Update the `POST` handler in `app/api/auth/me/route.ts` to accept optional profile fields:
```typescript
// Replace the upsert data block inside POST:
const { favoriteTeamId, displayName, avatarUrl } = await request.json().catch(() => ({}))

const user = await prisma.user.upsert({
  where: { firebaseUid: decoded.uid },
  update: {
    email: decoded.email ?? '',
    ...(displayName && { displayName }),
    ...(avatarUrl !== undefined && { avatarUrl }),
    ...(favoriteTeamId && { favoriteTeamId }),
  },
  create: {
    firebaseUid: decoded.uid,
    email: decoded.email ?? '',
    displayName: displayName ?? decoded.name ?? decoded.email?.split('@')[0] ?? 'Player',
    avatarUrl: avatarUrl ?? decoded.picture ?? null,
    favoriteTeamId: favoriteTeamId ?? null,
  },
})

const needsOnboarding = !user.favoriteTeamId && !favoriteTeamId
```

- [ ] **Step 5: Verify onboarding flow manually**

```bash
npm run dev
```
Open http://localhost:3000 — should redirect to /login. Sign in with Google. Should redirect to /onboarding. Complete all 3 steps. Should redirect to /.

- [ ] **Step 6: Commit**

```bash
git add app/
git commit -m "feat: add login page and onboarding flow with NHL team picker"
```

---

## Task 9: League Lobby + Settings UI

**Files:**
- Create: `app/(app)/page.tsx`
- Create: `app/(app)/league/create/page.tsx`
- Create: `app/(app)/league/[id]/page.tsx`
- Create: `app/(app)/league/[id]/settings/page.tsx`
- Create: `app/(app)/join/[code]/page.tsx`

- [ ] **Step 1: Create home page (league list)**

Create `app/(app)/page.tsx`:
```tsx
'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { auth } from '@/lib/firebase/client'
import Link from 'next/link'

interface League { id: string; name: string; status: string; members: { id: string }[] }

export default function HomePage() {
  const router = useRouter()
  const [leagues, setLeagues] = useState<League[]>([])

  useEffect(() => {
    async function load() {
      const token = await auth.currentUser?.getIdToken()
      if (!token) return
      const res = await fetch('/api/leagues', { headers: { Authorization: `Bearer ${token}` } })
      const data = await res.json()
      setLeagues(data.leagues ?? [])
    }
    load()
  }, [])

  return (
    <div className="min-h-screen bg-white p-6 max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-black tracking-widest">HOCKEYPOOLZ</h1>
        <Link href="/league/create" className="bg-orange-500 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-orange-600 transition">
          + Create League
        </Link>
      </div>
      {leagues.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-4xl mb-3">🏒</p>
          <p className="font-semibold">No leagues yet</p>
          <p className="text-sm mt-1">Create one or ask a friend for an invite link</p>
        </div>
      ) : (
        leagues.map(league => (
          <Link key={league.id} href={`/league/${league.id}`}
            className="block border-2 border-gray-100 rounded-xl p-4 mb-3 hover:border-orange-300 transition">
            <p className="font-bold">{league.name}</p>
            <p className="text-sm text-gray-500">{league.members.length} members · {league.status}</p>
          </Link>
        ))
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add GET /api/leagues for user's leagues**

Add `GET` export to `app/api/leagues/route.ts`:
```typescript
export async function GET(request: NextRequest) {
  try {
    const token = getBearerToken(request.headers.get('authorization'))
    const decoded = await verifyIdToken(token)
    const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const members = await prisma.leagueMember.findMany({
      where: { userId: user.id },
      include: {
        league: {
          include: { members: { select: { id: true } } },
        },
      },
      orderBy: { joinedAt: 'desc' },
    })

    const leagues = members.map(m => m.league)
    return NextResponse.json({ leagues })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 3: Create league creation page**

Create `app/(app)/league/create/page.tsx`:
```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { auth } from '@/lib/firebase/client'

export default function CreateLeaguePage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [maxTeams, setMaxTeams] = useState(8)
  const [playersPerTeam, setPlayersPerTeam] = useState(10)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function create() {
    setLoading(true)
    setError('')
    try {
      const token = await auth.currentUser?.getIdToken()
      const res = await fetch('/api/leagues', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, maxTeams, playersPerTeam }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error); return }
      router.push(`/league/${data.league.id}`)
    } catch {
      setError('Failed to create league')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-white p-6 max-w-lg mx-auto">
      <h1 className="text-2xl font-black tracking-widest mb-6">Create League</h1>
      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
      <label className="block text-sm font-semibold mb-1">League Name</label>
      <input className="w-full border-2 border-gray-200 rounded-xl p-3 mb-4 focus:border-orange-500 outline-none"
        value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Office Pool 2026" />
      <label className="block text-sm font-semibold mb-1">Max Teams ({maxTeams})</label>
      <input type="range" min={2} max={20} value={maxTeams} onChange={e => setMaxTeams(+e.target.value)}
        className="w-full mb-4 accent-orange-500" />
      <label className="block text-sm font-semibold mb-1">Players per Team ({playersPerTeam})</label>
      <input type="range" min={4} max={20} value={playersPerTeam} onChange={e => setPlayersPerTeam(+e.target.value)}
        className="w-full mb-6 accent-orange-500" />
      <button onClick={create} disabled={loading || !name.trim()}
        className="w-full py-3 rounded-xl font-bold text-white bg-orange-500 hover:bg-orange-600 transition disabled:opacity-40">
        {loading ? 'Creating…' : 'Create League'}
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Create league lobby page**

Create `app/(app)/league/[id]/page.tsx`:
```tsx
'use client'
import { useState, useEffect } from 'react'
import { auth } from '@/lib/firebase/client'
import Link from 'next/link'

interface LeagueDetail {
  id: string; name: string; inviteCode: string; status: string
  maxTeams: number; playersPerTeam: number
  commissioner: { displayName: string }
  members: { id: string; teamName: string; teamIcon: string | null; user: { displayName: string } }[]
}

export default function LeagueLobbyPage({ params }: { params: { id: string } }) {
  const [league, setLeague] = useState<LeagueDetail | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetch(`/api/leagues/${params.id}`).then(r => r.json()).then(d => setLeague(d.league))
  }, [params.id])

  if (!league) return <div className="p-6 text-gray-400 text-sm">Loading…</div>

  const inviteUrl = `${window.location.origin}/join/${league.inviteCode}`

  function copyLink() {
    navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="min-h-screen bg-white p-6 max-w-lg mx-auto">
      <h1 className="text-2xl font-black mb-1">{league.name}</h1>
      <p className="text-gray-500 text-sm mb-6">{league.members.length}/{league.maxTeams} teams · {league.playersPerTeam} players per team</p>

      <div className="bg-gray-50 rounded-xl p-4 mb-6">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Invite Link</p>
        <p className="text-sm text-gray-600 break-all mb-3">{inviteUrl}</p>
        <button onClick={copyLink}
          className="bg-orange-500 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-orange-600 transition">
          {copied ? '✓ Copied!' : 'Copy Link'}
        </button>
      </div>

      <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Teams ({league.members.length})</p>
      {league.members.map(m => (
        <div key={m.id} className="flex items-center gap-3 p-3 border-b border-gray-100">
          <span className="text-2xl">{m.teamIcon ?? '🏒'}</span>
          <div>
            <p className="font-semibold text-sm">{m.teamName}</p>
            <p className="text-xs text-gray-400">{m.user.displayName}</p>
          </div>
        </div>
      ))}

      <div className="mt-6 flex gap-3">
        <Link href={`/league/${league.id}/settings`}
          className="flex-1 text-center py-3 border-2 border-gray-200 rounded-xl text-sm font-bold hover:border-gray-400 transition">
          Scoring Settings
        </Link>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Create join page (invite link landing)**

Create `app/(app)/join/[code]/page.tsx`:
```tsx
'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { auth } from '@/lib/firebase/client'

interface League { id: string; name: string; commissioner: { displayName: string }; members: { id: string }[]; maxTeams: number }

export default function JoinPage({ params }: { params: { code: string } }) {
  const router = useRouter()
  const [league, setLeague] = useState<League | null>(null)
  const [teamName, setTeamName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Find league by invite code
  useEffect(() => {
    fetch(`/api/leagues/by-code/${params.code}`).then(r => r.json()).then(d => {
      if (d.league) setLeague(d.league)
      else setError('Invalid invite link')
    })
  }, [params.code])

  async function join() {
    if (!league) return
    setLoading(true)
    setError('')
    try {
      const token = await auth.currentUser?.getIdToken()
      const res = await fetch(`/api/leagues/${league.id}/join`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamName, inviteCode: params.code }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error); return }
      router.push(`/league/${league.id}`)
    } catch {
      setError('Failed to join league')
    } finally {
      setLoading(false)
    }
  }

  if (error && !league) return <div className="p-6 text-red-600">{error}</div>
  if (!league) return <div className="p-6 text-gray-400 text-sm">Loading…</div>

  return (
    <div className="min-h-screen bg-white p-6 max-w-sm mx-auto flex flex-col justify-center">
      <h1 className="text-xl font-black tracking-widest mb-1">HOCKEYPOOLZ</h1>
      <p className="text-gray-500 text-sm mb-6">You've been invited to join a league</p>
      <div className="bg-gray-50 rounded-xl p-4 mb-6">
        <p className="font-bold text-lg">{league.name}</p>
        <p className="text-sm text-gray-500">Created by {league.commissioner.displayName}</p>
        <p className="text-sm text-gray-500">{league.members.length}/{league.maxTeams} teams</p>
      </div>
      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
      <label className="text-sm font-semibold mb-1 block">Your Team Name</label>
      <input className="w-full border-2 border-gray-200 rounded-xl p-3 mb-4 focus:border-orange-500 outline-none"
        value={teamName} onChange={e => setTeamName(e.target.value)} placeholder="e.g. BobsTeam" />
      <button onClick={join} disabled={loading || !teamName.trim()}
        className="w-full py-3 rounded-xl font-bold text-white bg-orange-500 hover:bg-orange-600 transition disabled:opacity-40">
        {loading ? 'Joining…' : 'Join League'}
      </button>
    </div>
  )
}
```

- [ ] **Step 6: Add GET /api/leagues/by-code/[code] route**

Create `app/api/leagues/by-code/[code]/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest, { params }: { params: { code: string } }) {
  const league = await prisma.league.findUnique({
    where: { inviteCode: params.code },
    include: {
      commissioner: { select: { displayName: true } },
      members: { select: { id: true } },
    },
  })
  if (!league) return NextResponse.json({ error: 'Invalid invite code' }, { status: 404 })
  return NextResponse.json({ league })
}
```

- [ ] **Step 7: Commit**

```bash
git add app/
git commit -m "feat: add league lobby, create, join, and home pages"
```

---

## Task 10: Deploy to Vercel

**Files:**
- Create: `vercel.json`

- [ ] **Step 1: Create Vercel project**

```bash
npx vercel link
```
Follow prompts to link to your Vercel account and create the project.

- [ ] **Step 2: Add environment variables to Vercel**

In the Vercel dashboard → Project → Settings → Environment Variables, add all keys from `.env.local.example`. For `FIREBASE_PRIVATE_KEY`, paste the full key including `\n` characters.

- [ ] **Step 3: Add Neon integration**

In Vercel dashboard → Integrations → Neon → Connect. This auto-populates `DATABASE_URL` and `DIRECT_URL` in Vercel env vars.

- [ ] **Step 4: Configure cron (for future plans)**

Create `vercel.json`:
```json
{
  "crons": [
    {
      "path": "/api/cron/sync-stats",
      "schedule": "0 8 * * *"
    },
    {
      "path": "/api/cron/generate-recaps",
      "schedule": "30 8 * * *"
    }
  ]
}
```

- [ ] **Step 5: Deploy**

```bash
npx vercel --prod
```
Expected: App live at `https://hockeypoolz.vercel.app` (or your assigned domain)

- [ ] **Step 6: Run production smoke test**

- Open the deployed URL
- Sign in with Google → should redirect to /onboarding
- Complete onboarding → should reach home page
- Create a league → should see lobby with invite link
- Open invite link in incognito → should see league preview

- [ ] **Step 7: Final commit**

```bash
git add vercel.json
git commit -m "feat: add Vercel config and deploy Plan 1 to production"
```

---

## Self-Review Checklist

- [x] Firebase Auth (Google + Apple SSO) — Tasks 4, 5, 8
- [x] User creation on first login — Task 5
- [x] Onboarding: team name, icon, NHL team picker — Task 8
- [x] NHL team color data (all 32 teams) — Task 3
- [x] Database seed for NHL teams — Task 3
- [x] League creation with name, max teams, players per team — Task 6
- [x] Scoring settings with defaults (commissioner-only PUT) — Task 7
- [x] Join via invite code — Task 6
- [x] League lobby with invite link sharing — Task 9
- [x] Auth middleware blocking unauthenticated access — Task 5
- [x] `is_banned` enforcement on league join and creation — Tasks 6
- [x] Vercel deployment — Task 10
- [x] All 32 teams with conference/division organization — Task 3

**What Plan 1 does NOT include (covered in Plans 2–4):**
- Draft engine, autodraft, mock draft → Plan 2
- StatsService, scoring calculation, standings → Plan 3
- Morning Recap (Claude API), cron jobs → Plan 3
- Platform Admin panel → Plan 4
