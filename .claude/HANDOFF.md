# HockeyPoolz — Session Handoff
_Last updated: 2026-04-18 (session 68bb7d30)_

---

## What Was Done This Session

### 1. Cron pipeline — root cause found and fixed (commit `c719b6b`)

**All three bugs that caused crons to never fire:**

| Bug | File | Fix |
|-----|------|-----|
| Routes exported `POST`, Vercel crons send `GET` — silent 405 on every scheduled run | `app/api/cron/sync-stats/route.ts`, `app/api/cron/generate-recaps/route.ts` | Changed `POST` → `GET` |
| `checkEliminations()` hits NHL bracket API; 429 rate limit aborted the whole sync including score recalc | `app/api/cron/sync-stats/route.ts` | Wrapped in non-fatal try/catch |
| `calcMemberScores` queried `playerGameStats` with `"po-${gameId}"` but stats are stored as plain `"${gameId}"` — every game summary said "No league members had players in this game" | `lib/scores-service.ts` | Removed `po-` prefix from both lookup and create |

**To deploy:** push `main` to Vercel. The 11pm and 2am ET crons will then work automatically.

**To trigger a manual sync after deploying:**
```bash
curl -X GET https://hockey-poolz.vercel.app/api/cron/sync-stats \
  -H "Authorization: Bearer $CRON_SECRET"
```

### 2. New scripts added

- **`scripts/list-alpha-users.mjs`** — pulls all Firebase Auth users (email-having) and prints JSON. Used by the signyl-alpha-loop skill to get the tester list. Run with `node scripts/list-alpha-users.mjs` from the project root.
- **`scripts/manual-sync.mjs`** — direct stats sync bypassing the HTTP endpoint. Only works when DATABASE_URL is in the environment (it's a Vercel env var, not in .env.local — can't run locally without it).

---

## Pending / Pick Up Here

### Alpha welcome emails — NOT sent yet
The signyl-alpha-loop skill ran against HockeyPoolz and pulled 22 testers from Firebase. Welcome emails were drafted but NOT sent due to Gmail MCP issues during the session.

**Before sending, resolve these duplicates in Firebase:**
- Lennon appears twice (probably two different accounts — confirm which to keep)
- Matthew Caluori appears twice
- "AD29" — unclear display name, needs review
- "Terraclean" — unclear display name, needs review

After cleanup, re-run `node scripts/list-alpha-users.mjs` to confirm clean list, then invoke the signyl-alpha-loop skill to send Day 0 welcome emails.

### Cron manual sync still needed
The April 18 playoff games (OTT@CAR, MIN@DAL, PHI@PIT) haven't been synced yet because the fix isn't deployed. After pushing and deploying, run the manual sync curl above.

### Local branches not merged
```
fix-team-icons      # unmerged local branch
sync-regular-season # unmerged local branch  
teams               # unmerged local branch
feature/plan-8-invite-approvals  # local, not pushed
```
Review these before continuing feature work.

---

## Architecture Context

### Stats pipeline (how it works now)
1. Cron at 11pm ET (3am UTC) → `GET /api/cron/sync-stats`
2. Syncs "yesterday" + "today" dates
3. `fetchCompletedPlayoffGames(date)` — filters `gameType === 3 && gameState === 'OFF'` (playoff only, not regular season — by design)
4. Box score → `playerGameStats` upsert (basic stats: goals, assists, shots, hits, etc.)
5. Game log → `playerGameStats` update (extended: PP points, SH goals, GWG, shutouts)
6. `checkEliminations()` — non-fatal, marks teams with `eliminatedAt`
7. `recalculateScores(leagueId)` for all `status: 'active'` leagues
8. `writeMemberDailyScores(leagueId, yesterday)` for each active league
9. Cron at 2am ET (6am UTC) — same, catch-all for late west coast games
10. Cron at 7:30am ET (11:30am UTC) → `GET /api/cron/generate-recaps` — AI summaries + WhatsApp DMs

### Game IDs
- Stored in `playerGameStats.gameId` as plain numeric string: `"2025030131"`
- Same in `leagueGameSummary.gameId`
- No prefix. Don't add one.

### Season code
- 2025-26 playoffs = `'20252026'` (used in `fetchPlayerGameLog`)

### DB connection
- DATABASE_URL is a **Vercel environment variable**, not in `.env.local`
- Local scripts that use Prisma won't work without it
- PrismaClient requires `PrismaPg` adapter — see `lib/prisma.ts`
- Neon Postgres (pooled URL for app, direct URL for migrations)

### WhatsApp
- Meta Graph API v19.0 (not Twilio — switched in commit `6bd70c4`)
- Env vars: `META_WHATSAPP_TOKEN`, `META_WHATSAPP_PHONE_NUMBER_ID`
- Phone number ID: `1093476393854740`
- Sends after per-member recap if `whatsappOptedIn === true`

### Vercel
- Production URL: `https://hockey-poolz.vercel.app`
- Custom domain target: `hockeypoolz.signyl.gg`
- Team: `lennon-gtm-projects` (team ID in Vercel settings)
- Blob store provisioned for team icons

---

## Key Files Reference

| File | What it does |
|------|-------------|
| `lib/stats-service.ts` | All NHL API + score calc logic. Single source of truth for stats. |
| `lib/scores-service.ts` | AI game summaries, benefactor callouts, `LeagueGameSummary` writes |
| `lib/recap-service.ts` | Per-member + league-wide AI recaps |
| `lib/whatsapp-service.ts` | Meta Cloud API WhatsApp sender |
| `lib/prisma.ts` | PrismaClient singleton with PrismaPg adapter |
| `app/api/cron/sync-stats/route.ts` | GET handler — stats sync pipeline |
| `app/api/cron/generate-recaps/route.ts` | GET handler — AI recaps + summaries |
| `prisma/schema.prisma` | Full schema — League, LeagueMember, DraftPick, PlayerGameStats, etc. |
| `scripts/list-alpha-users.mjs` | Firebase Auth user list (runs standalone with .env.local) |
| `scripts/manual-sync.mjs` | Direct stats sync (needs DATABASE_URL env var) |

---

## Alpha Loop Context

- Skill: `Signyl/skills/signyl-alpha-loop/` (also packaged as `signyl-alpha-loop.skill`)
- 22 alpha testers in Firebase (run `node scripts/list-alpha-users.mjs` to list)
- Tested Day 0 welcome copy — Signyl + HockeyPoolz co-branded, founder's living-room tone
- Survey form: https://tinyurl.com/5hev6fhs
- Notion workspace should be under "Signyl Projects" DB once Day 0 runs
