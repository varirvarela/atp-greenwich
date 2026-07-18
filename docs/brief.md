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
| Scheduled jobs | GitHub Actions cron: push notifications (every 5 min), email (every 5 min), deadline check (daily), daily feed digest (7am + 9pm EST) |

There are two separate Vite builds:
- **Player app** (`src/player/`) — the main PWA players install
- **Admin app** (`src/admin/`) — password-protected dashboard for league management

Shared code lives in `src/shared/` (scoring logic, Firebase helpers, activity feed writes, changelog).

---

## Firebase data shape

```
players/
  {uid}: { name, alias, eloRating, status, avatarId, isAdmin, pushSubscription, ... }

seasons/
  {sid}/
    name, createdAt
    leagues/
      {lid}/
        name, members/{uid}: true
        groupStageConfig: { status, deadline, pointsConfig, qualifyPoints }
        matches/
          {mid}: { playerA, playerB, proposedBy, proposedAt, scheduledAt,
                   status, groupMatch, deadline, result, photoUrl,
                   eloDeltas, confirmedAt, forfeited, pushNotified }
        bracket/
          rounds/: [ [{playerA, playerB, winner}] ]

activity/           ← global feed events (all seasons)
  {aid}: { type, ts, sid, lid, ...payload }

config/
  defaultSeason: sid
  dailyDigest/{dateET}/schedule/{lid}: true   ← dedup flag
  dailyDigest/{dateET}/standings/{lid}: true  ← dedup flag

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
| Matches | `src/player/matches.js` | Propose/accept/decline challenges, enter results + photo, confirm or dispute, reschedule, forfeit group matches |
| Standings | `src/player/standings.js` | League table sorted by W/L/GD; group-points mode during group stage; click any player for profile modal |
| Bracket | `src/player/bracket.js` | Knockout draw; group-points qualification tracker |
| Profile | `src/player/app.js` | Avatar/alias edit, ELO tier, stats, push-notification opt-in, install PWA, walkthrough |

Clicking any player name or avatar anywhere in the app opens **`showPlayerModal`** (`src/player/player-modal.js`) — a unified profile sheet showing 6 stat tiles (Played / Won / Lost / Missed / Forfeit / Opp.Forfeit), ELO + tier badge, and the last 20 confirmed matches with ELO deltas.

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

Group-stage matches have a `deadline` (forfeit if not played) and `groupMatch: true`. The admin can forfeit or apply deadline penalties server-side.

Match formats: **Best-of-3** (sets with optional tiebreak) or **Pro 10** (single score 0–10).

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
| `daily_schedule` | `scripts/daily-digest.js` at 7am EST | "Today's matches · Liga A — A vs B at 7pm" |
| `standings_update` | `scripts/daily-digest.js` at 9pm EST | "End of day standings · Liga A — 1. X 4-1 …" |

---

## Admin app sections

| Section | What it does |
|---|---|
| Players | Approve/reject registrations; edit ELO; assign leagues; grant admin; delete players |
| Matches | Filter + view all matches across seasons; override results |
| Leagues | Create leagues; assign members; configure + release group-stage fixtures (round-robin scheduler with validation preview); close group stage |
| Bracket | Publish knockout draw; advance winners; handle BYEs |
| Settings | View app version; manage push VAPID config |

---

## Scheduled GitHub Actions

| Workflow | Schedule | Script |
|---|---|---|
| `send-push.yml` | every 5 min | `scripts/send-push.js` — push notifications for new challenges, results, confirmations |
| `send-email.yml` | every 5 min | `scripts/send-email.js` — email for same events + league assignments |
| `deadline-check.yml` | 8am UTC daily | `scripts/deadline-check.js` — apply missed-deadline penalties |
| `daily-digest.yml` | 12pm UTC (7am EST) + 2am UTC (9pm EST) | `scripts/daily-digest.js` — post schedule preview / end-of-day standings to feed |
| `backup.yml` | 3am UTC daily | `scripts/backup.js` — snapshot RTDB to GitHub Actions artifact (30-day retention) |
| `deploy.yml` | push to `main` | Build + deploy to GitHub Pages + push Firebase database & storage rules |

---

## Local development

```bash
npm install
npm run dev          # player app on :5173 (DEV_ROOT = '_dev/' — isolated from prod data)
npm run dev:admin    # admin app on :5174
npm run test         # vitest unit tests (scoring, ELO, fixtures)
npm run test:e2e     # Playwright E2E (requires Firebase emulator running on :9000)
firebase emulators:start --only database --project atp-greenwich
```

The `DEV_ROOT = '_dev/'` prefix is applied to all Firebase RTDB paths in dev mode, keeping dev data isolated from production. Storage paths follow the same convention (`_dev/match-photos/…`).

---

## Key files for new contributors

| File | Purpose |
|---|---|
| `src/shared/scoring.js` | ELO, standings table, group points, fixture generation (`generateFixtures` / `validateFixtures`) |
| `src/shared/activity.js` | `writeActivity(type, payload)` — single function all feed writes go through |
| `src/shared/firebase.js` | Firebase init, all DB/storage helpers, `DEV_ROOT` prefix logic |
| `src/shared/tz.js` | `fmtTime(ts)` — always formats in America/New_York (Eastern Time) |
| `src/player/player-modal.js` | `showPlayerModal()` — unified player profile popup used everywhere |
| `scripts/send-push.js` | Reference pattern for all server-side scripts (firebase-admin, CommonJS) |
| `e2e/helpers.js` | `seedData`, `clearData`, `freshStart`, `adminWrite`, `adminRead` — test utilities |
