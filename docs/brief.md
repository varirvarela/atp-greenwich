# ATP Greenwich — Product Brief

ATP Greenwich is a mobile-first progressive web app (PWA) for running a private amateur tennis league. Players register with an invite code, get approved by an admin, and are assigned to a league within a season/tournament. The admin manages the full lifecycle — leagues, group stage fixtures, knockout bracket — while players manage their matches, results, and social feed from their phones.

---

## Architecture

| Layer | Tech |
|---|---|
| Frontend | Vanilla JS (ES modules), Vite bundler |
| Backend | Firebase Realtime Database (all data), Firebase Storage (match photos) |
| Auth | Custom password hash stored in RTDB — no Firebase Auth |
| Hosting | GitHub Pages (player app at `/`, admin at `/admin/`) |
| CI/CD | GitHub Actions: E2E tests (Playwright), deploy on push to `main` |
| Scheduled jobs | **Cloudflare Worker** (`workers/src/`) — push notifications, daily digest, deadline check (replaces GitHub Actions crons) |
| WhatsApp | Cloudflare Worker sends group messages via WhatsApp Business API (`workers/src/whatsapp.js`) |

There are two separate Vite builds:
- **Player app** (`src/player/`) — the main PWA players install
- **Admin app** (`src/admin/`) — password-protected dashboard for league management

Shared code lives in `src/shared/` (scoring logic, Firebase helpers, activity feed writes, changelog).

---

## Firebase data shape

```
players/
  {uid}: { name, alias, eloRating, status, avatarId, isAdmin,
           pushSubscription, lastActive, pwaMode, ... }

seasons/
  {sid}/
    name, createdAt
    leagues/
      {lid}/
        name, members/{uid}: true
        pointsConfig: { played, wonBonus, missed, forfeitLoser, forfeitWinner }
        groupStageConfig: { status, deadline, matchesPerPlayer, qualifyPoints }
        matches/
          {mid}: { playerA, playerB, proposedBy, proposedAt, scheduledAt,
                   status, groupMatch, deadline, result, photoUrl,
                   eloDeltas, confirmedAt, forfeited, pushNotified,
                   deadlinePenaltyApplied }
        bracket/
          rounds/: [ [{playerA, playerB, winner}] ]

activity/           ← global feed events (all seasons)
  {aid}: { type, ts, sid, lid, ...payload }

config/
  defaultSeason: sid
  dailyDigest/{dateET}/schedule/{lid}: true    ← dedup flag
  dailyDigest/{dateET}/standings/{lid}: true   ← dedup flag
  dailyDigest/{dateET}/activation: true        ← dedup flag (WA nudge)
  whatsappPrefs: { dailySchedule, eveningStandings }

inviteCodes/
  {code}: { used, usedBy }

password_resets/
  {token}: { email, expiresAt }
```

Storage bucket path: `match-photos/{matchId}.{ext}` (prod), `_dev/match-photos/...` (dev).

---

## Player app tabs

| Tab | File | What it does |
|---|---|---|
| Feed | `src/player/feed.js` | Confirmed results, activity cards (challenges, joins, rescheduling, daily digest), emoji reactions |
| Matches | `src/player/matches.js` | Propose/accept/decline challenges, enter results + photo, confirm or dispute, reschedule/remove date, forfeit group matches |
| Standings | `src/player/standings.js` | League table sorted by group points during group stage, W/L/GD otherwise; click any player for profile modal |
| Bracket | `src/player/bracket.js` | Knockout draw; group-points qualification tracker |
| Profile | `src/player/app.js` | Avatar/alias edit, ELO tier, stats, push-notification opt-in, install PWA, walkthrough |

Clicking any player name or avatar anywhere in the app opens **`showPlayerModal`** (`src/player/player-modal.js`) — a unified profile sheet showing stat tiles (Played / Won / Lost / Missed / Forfeit / Opp.Forfeit), ELO + tier badge, and the last 20 confirmed matches with ELO deltas.

---

## Match lifecycle

```
open_challenge  ──accept──►  scheduled
                             │
                     result  │  enter-result
                     pending ◄──────────────
                             │
                     photo   │  (if no photo yet)
                     pending ◄──────────────
                             │
                  confirmed  ◄──────────────
                             │
                (either player may adjust-result → recalc ELO)
```

Group-stage matches have a `deadline` (forfeit if not played by admin action) and `groupMatch: true`. The admin can apply deadline penalties or forfeit server-side.

Match formats: **Best-of-3** (sets with optional tiebreak — tiebreak can be manually added to any set, not just at 6-6) or **Pro 10** (single score 0–10).

ELO is recalculated on every confirm/adjust via `calculateElo()` in `src/shared/elo.js` (standard K-factor formula).

---

## Feed activity types

| Type | Written by | Card shows |
|---|---|---|
| `match_proposed` | player proposing | "X sent a challenge vs Y" |
| `match_confirmed` | result confirm flow | Full score card with photo + reactions |
| `match_rescheduled` | either player rescheduling | "X rescheduled vs Y · new time" |
| `joined_league` | admin assigning player | "X joined Liga A" |
| `fixtures_released` | admin releasing group stage | "New fixtures published · N matches" |
| `bracket_advance` | admin advancing bracket | "X advanced in the bracket" |
| `profile_change` | player editing avatar/alias | "X updated their avatar/alias" |
| `new_player` | (seeded in tests only) | "X joined the tournament" |
| `daily_schedule` | Cloudflare Worker at 8am ET | "Today's matches · Liga A — A vs B at 7pm" |
| `standings_update` | Cloudflare Worker at 10pm ET | "End of day standings · Liga A — 1. X 9pts …" |

---

## Admin app sections

| Section | What it does |
|---|---|
| Players | Approve/reject registrations; edit ELO; assign leagues; grant admin; delete players; view per-player stats (matches proposed/played/won, ELO change, last active, PWA usage) |
| Matches | Filter + view all matches across seasons; override results |
| Leagues | Create leagues; assign members; configure + release group-stage fixtures (round-robin scheduler with validation preview); close group stage; set group stage deadline (auto-backfills all open match records) |
| Bracket | Publish knockout draw; advance winners; handle BYEs |
| Stats | Summary cards (active players, match counts, ELO spread) with bar charts; per-player sortable table; PWA vs browser usage split |
| Settings | View app version; manage push VAPID config |

---

## Cloudflare Worker (scheduled jobs)

All background jobs run in a single Cloudflare Worker (`workers/src/`) triggered by cron expressions. The worker handles Firebase via REST (`workers/src/firebase.js`) and does not use the Firebase Admin SDK.

| Cron | What it does |
|---|---|
| `*/5 * * * *` | Send push notifications for pending match events (`workers/src/send-push.js`) |
| `0 12 * * *` | Morning schedule digest (8am ET): posts today's matches to the feed + WA group, appends a daily encouraging message; sends push reminders to players with matches today |
| `0 2 * * *` | Evening standings digest (10pm ET): posts standings sorted by league points to the feed + WA group, including individual match scores |
| `0 12 * * *` | If no matches today: sends a daily WhatsApp activation nudge (Argentine Spanish, 60-message pool, Low/Medium/High spice, with AI disclaimer) |
| `0 8 * * *` | Deadline check: applies missed-deadline penalties to overdue group matches |

WhatsApp messages are sent via `workers/src/whatsapp.js`. Enabled/disabled per league via `config/whatsappPrefs`.

---

## Local development

```bash
npm install
npm run dev          # player app on :5173 (DEV_ROOT = '_dev/' — isolated from prod data)
npm run dev:admin    # admin app on :5174
npm run test         # vitest unit tests (scoring, ELO, fixtures, group points)
npm run test:e2e     # Playwright E2E (requires Firebase emulator running on :9000)
firebase emulators:start --only database --project atp-greenwich
```

The `DEV_ROOT = '_dev/'` prefix is applied to all Firebase RTDB paths in dev mode, keeping dev data isolated from production. Storage paths follow the same convention (`_dev/match-photos/…`).

---

## Key files for new contributors

| File | Purpose |
|---|---|
| `src/shared/scoring.js` | ELO standings table, group points (`calculateGroupPoints`), fixture generation (`generateFixtures` / `validateFixtures`) |
| `src/shared/activity.js` | `writeActivity(type, payload)` — single function all feed writes go through |
| `src/shared/firebase.js` | Firebase init, all DB/storage helpers, `DEV_ROOT` prefix logic |
| `src/shared/tz.js` | `fmtTime(ts)` — always formats in America/New_York (Eastern Time) |
| `src/player/player-modal.js` | `showPlayerModal()` — unified player profile popup used everywhere |
| `workers/src/daily-digest.js` | Morning schedule + evening standings + activation nudge logic |
| `workers/src/activation-messages.js` | 60 no-match-day WhatsApp nudges (Argentine Spanish) |
| `workers/src/encouraging-messages.js` | 30 match-day WhatsApp messages (Argentine Spanish) |
| `e2e/helpers.js` | `seedData`, `clearData`, `freshStart`, `adminWrite`, `adminRead` — test utilities |
