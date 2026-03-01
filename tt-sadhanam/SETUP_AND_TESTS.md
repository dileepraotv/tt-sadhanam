# Table Tennis Tournament Manager
## Setup Guide & Test Plan

---

## PART 1 — STEP-BY-STEP SETUP (Non-developer friendly)

### Prerequisites
You need:
- A computer with internet access
- Node.js installed (download from nodejs.org — choose the LTS version)
- A free Supabase account (supabase.com)
- A free Vercel account for deployment (vercel.com) — OR run locally

---

### Step 1 — Create Your Supabase Project

1. Go to **supabase.com** and sign up / sign in.
2. Click **"New project"**.
3. Choose a name (e.g. "tt-tournament"), set a strong database password, pick a region.
4. Wait ~2 minutes for the project to be ready.
5. Go to **Settings → API** in the left sidebar.
6. You'll need two values:
   - **Project URL** — looks like `https://abcdefg.supabase.co`
   - **anon public key** — a long string starting with `eyJ...`
   
Keep this page open.

---

### Step 2 — Run the SQL Schema

1. In your Supabase project, click **SQL Editor** in the left sidebar.
2. Click **"New query"**.
3. Open the file `supabase-schema.sql` (from Step 2 of this project).
4. Paste the entire SQL block and click **"Run"** (Ctrl+Enter).
5. You should see "Success. No rows returned." at the bottom.
6. **Replace the admin UUID** in the demo data section with your own:
   - Go to **Authentication → Users** 
   - Sign up once via the app (Step 5 below), then come back and get your UUID
   - Re-run only the demo data section with the real UUID

---

### Step 3 — Set Up the App Locally

Open **Terminal** (Mac: Cmd+Space → "Terminal") or **Command Prompt** (Windows).

```bash
# Navigate to where you downloaded the project
cd tt-tournament

# Install all dependencies
npm install

# Copy the environment file
cp .env.local.example .env.local
```

Now open `.env.local` in a text editor and fill in:
```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-very-long-anon-key
```

---

### Step 4 — Enable Realtime in Supabase

1. In Supabase, go to **Database → Replication** (left sidebar).
2. Under **Supabase Realtime**, click the toggle next to:
   - `matches` ← enable this
   - `games` ← enable this
   - `tournaments` ← enable this
3. Save changes.

---

### Step 5 — Run the App

```bash
npm run dev
```

Open your browser to **http://localhost:3000**

Click **"Admin Sign In"** → **"Don't have an account? Sign up"** → create your admin account.

---

### Step 6 — Deploy to Vercel (Optional, for sharing)

1. Push your code to GitHub (create a free repo at github.com).
2. Go to **vercel.com** → **"New Project"** → import your GitHub repo.
3. Under **Environment Variables**, add:
   - `NEXT_PUBLIC_SUPABASE_URL` = your Supabase URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = your anon key
4. Click **Deploy**. Your app is now live at `yourapp.vercel.app`.

---

## PART 2 — RUNNING A TOURNAMENT (Admin Workflow)

### Full Workflow Checklist

```
□ 1. Sign in as admin at /
□ 2. Click "New Tournament"
□ 3. Fill in name, date, location, and match format (Bo3/Bo5/Bo7)
□ 4. Click "Create Tournament"
□ 5. Go to Players tab
□ 6. Add players (one-by-one or paste a list)
□ 7. Assign seeds 1–8 to your top 8 players using the seed dropdowns
□ 8. Go to Setup tab
□ 9. Click "Generate Draw"
□ 10. Go to Bracket tab — verify the draw looks correct
□ 11. Toggle "Public Live View" ON to publish the bracket
□ 12. Copy the public URL and share with your audience
□ 13. As matches are played: click a match → enter game scores
□ 14. Winners auto-advance to the next round
□ 15. After the Final, the champion is displayed
```

---

## PART 3 — MANUAL TEST PLAN

### Test Group 1: Authentication

| # | Test | Expected Result | Status |
|---|------|----------------|--------|
| 1.1 | Sign up with new email/password | Account created, redirected to home, admin nav shown | |
| 1.2 | Sign out and sign back in | Successfully signed in | |
| 1.3 | Visit /admin/tournaments/[id] without signing in | Redirected to home | |
| 1.4 | Visit /tournaments/[id] without signing in | Public bracket shown (no auth needed) | |
| 1.5 | Try to view another admin's unpublished tournament | Redirected / not found | |

---

### Test Group 2: Tournament Creation

| # | Test | Expected Result |
|---|------|----------------|
| 2.1 | Create tournament with all fields filled | Tournament created, redirected to admin dashboard |
| 2.2 | Create tournament with only name | Tournament created (date/location optional) |
| 2.3 | Create tournament with name blank | Form validation prevents submission |
| 2.4 | Create Bo3, Bo5, Bo7 tournaments | Format saved correctly, shown in UI |

---

### Test Group 3: Player Management

| # | Test | Expected Result |
|---|------|----------------|
| 3.1 | Add single player with name only | Player appears in list, unseeded |
| 3.2 | Add single player with name + seed 1 | Player appears with [1] badge |
| 3.3 | Try to assign seed 1 to a second player | First player's seed 1 is removed, new player gets seed 1 |
| 3.4 | Paste 10 names in bulk mode | All 10 added as unseeded |
| 3.5 | Paste 257+ names | Error: "Would exceed 256 player limit" |
| 3.6 | Delete a player before bracket generation | Player removed from list |
| 3.7 | Add 2 players with seeds 1 and 2 | Both seeds shown correctly, no duplicates |
| 3.8 | Change a player's seed from dropdown | Seed updated immediately |

---

### Test Group 4: Bracket Generation

| # | Test | Expected Result |
|---|------|----------------|
| 4.1 | Generate with 2 players | 1 match, bracket size 2, 0 byes |
| 4.2 | Generate with 16 players, seeds 1–8 | Bracket size 16, seed 1 at slot 1, seed 2 at slot 16 |
| 4.3 | Generate with 12 players | Bracket size 16, 4 bye matches auto-completed |
| 4.4 | Generate with 5 players, seed 1 only | Bracket size 8, 3 byes, seed 1 never faces a bye |
| 4.5 | Verify seeds 3&4 in opposite halves (16-draw) | Slots 1-8 has one of {3,4}, slots 9-16 has the other |
| 4.6 | Verify seeds 5-8 in separate quarters | Each quarter (1-4, 5-8, 9-12, 13-16) has at most one of seeds 5-8 |
| 4.7 | Re-generate after scores entered | Confirmation dialog shown; after confirm, all scores wiped |
| 4.8 | Player list locked after generation | Add/delete player buttons hidden |
| 4.9 | Generate with 1 player | Error: "Need at least 2 players" |

---

### Test Group 5: Score Entry

| # | Test | Expected Result |
|---|------|----------------|
| 5.1 | Enter game 1 scores (11–7) and save | Score saved, match status → live |
| 5.2 | Enter game 2 scores and save | Tally updates |
| 5.3 | Bo5: Enter 3 games where player1 wins all | Player1 wins match 3–0, match status → complete |
| 5.4 | Bo5: Enter 5 games with tight match | Winner declared after game 5 |
| 5.5 | Winner of complete match appears in next round | Next match shows winner's name in their slot |
| 5.6 | Delete a game score | Tally recalculated, match reverts to live/pending |
| 5.7 | Enter non-numeric score | Save button stays disabled |
| 5.8 | Game 6 of Bo5 cannot be entered | Game rows after max are disabled/hidden |
| 5.9 | Mark match as live before entering scores | Match status changes to live |
| 5.10| Audit log updated on each score entry | Row visible in Supabase audit_log table |

---

### Test Group 6: Public View & Realtime

| # | Test | Expected Result |
|---|------|----------------|
| 6.1 | Visit /tournaments/[id] for unpublished tournament | 404 Not Found page |
| 6.2 | Visit /tournaments/[id] after publishing | Full bracket visible |
| 6.3 | Open public URL in separate browser, admin enters score | Score updates within 1–2 seconds without refresh |
| 6.4 | Admin marks match live | Live badge appears on public view instantly |
| 6.5 | Click a match on public view | Sidebar shows game-by-game breakdown |
| 6.6 | Round tab navigation | Correct matches shown for each round |
| 6.7 | "All" bracket view | Horizontal bracket renders all rounds |
| 6.8 | Mobile: all rounds viewable | No horizontal overflow issues |
| 6.9 | Champion declared | Trophy + winner name shown in public view |

---

### Test Group 7: Publish Toggle

| # | Test | Expected Result |
|---|------|----------------|
| 7.1 | Toggle publish ON | Tournament status → active, public URL works |
| 7.2 | Toggle publish OFF | Public URL returns 404 |
| 7.3 | Toggle without bracket generated | Switch disabled |
| 7.4 | Public link copy button | URL copied to clipboard |

---

## PART 4 — EDGE CASES & KNOWN BEHAVIORS

### Seeding Edge Cases

| Scenario | Behavior |
|----------|----------|
| Only seed 1 assigned, rest unseeded | Seed 1 at slot 1; remaining 7 anchor positions filled randomly by unseeded players |
| Seeds 3 and 4 only (no 1 or 2) | Placed in the two "half-end" anchors; seed 1/2 anchor positions filled by unseeded |
| 0 seeds assigned | Full random draw; bracket still valid |
| 8 seeds assigned in a 256-player bracket | All 8 seeded players in separate 32-player sections; guaranteed no meeting before QF |

### Bye Edge Cases

| Scenario | Behavior |
|----------|----------|
| 3 players (bracket size 4, 1 bye) | 1 unseeded player gets bye (highest seed doesn't need it—they have fixed positions) |
| 16 players (no byes) | Clean draw, no byes |
| 257 players | Error thrown before bracket generation |
| All players are BYEs in one quarter | Cannot happen — byes only equal bracketSize minus playerCount |

### Score Correction Edge Cases

| Scenario | Behavior |
|----------|----------|
| Delete game score after match completed | Match reverts to live; winner de-propagated from next round (if next match not started) |
| Delete game from a match whose winner is already in a completed next-round match | Winner NOT de-propagated (safety check) — admin must manually correct |
| Enter tie score (11–11) | Game saved; no winner assigned; neither player's games tally increases |
| Re-enter score for existing game | Upserted (replaced); tally recalculated |

### Realtime Edge Cases

| Scenario | Behavior |
|----------|----------|
| Network disconnects mid-tournament | Supabase client reconnects automatically; scores catch up |
| Two admins enter scores simultaneously | Last write wins; both see final state |
| Very large tournament (256 players) | 128 first-round matches rendered; virtual scrolling via round tabs prevents DOM overload |

---

## PART 5 — COMMON ISSUES & FIXES

### "Cannot find module '@supabase/ssr'"
```bash
npm install @supabase/ssr @supabase/supabase-js
```

### "RLS policy violation" when inserting data
- Make sure you're signed in as the tournament creator
- Check your Supabase Auth → Users to verify the user exists
- Re-run the SQL schema to ensure all RLS policies are applied

### Realtime not working
- Verify you enabled Realtime for the `matches`, `games`, and `tournaments` tables in Supabase Dashboard → Database → Replication
- Check browser console for WebSocket connection errors
- Make sure `NEXT_PUBLIC_SUPABASE_ANON_KEY` is the **anon** key (not the service role key)

### Bracket slots show "TBD" after generation
- Ensure the `bracket_slots` and `matches` tables have the correct RLS policies
- Try hard-refreshing the page (Ctrl+Shift+R)
- Check Supabase → Table Editor → matches to verify rows were created

### Google Fonts not loading
- Check your internet connection; fonts are loaded from `fonts.googleapis.com`
- For offline use, download Oswald and Barlow fonts and serve them locally via `next/font/local`

---

## PART 6 — ARCHITECTURE REFERENCE

```
src/
├── app/
│   ├── layout.tsx                         # Root layout (dark theme, fonts, Toaster)
│   ├── page.tsx                           # Landing: tournament list
│   ├── auth-button.tsx                    # Client: sign in/sign up dialog
│   ├── not-found.tsx
│   ├── admin/tournaments/
│   │   ├── new/page.tsx                   # Create tournament form
│   │   └── [id]/
│   │       ├── page.tsx                   # Admin dashboard (Setup/Players/Bracket tabs)
│   │       └── match/[matchId]/
│   │           ├── page.tsx               # Server: load match data
│   │           └── client.tsx             # Client: game-by-game score entry + realtime
│   └── tournaments/
│       └── [id]/
│           ├── page.tsx                   # Server: load public data
│           └── client.tsx                 # Client: public viewer + realtime
├── components/
│   ├── bracket/
│   │   ├── BracketView.tsx               # Round tabs + full bracket + round list
│   │   └── MatchCard.tsx                 # Individual match card
│   ├── admin/
│   │   ├── PlayerManager.tsx             # Add/delete/seed players
│   │   └── BracketControls.tsx           # Generate + publish controls
│   ├── shared/
│   │   ├── Header.tsx                    # Site navigation
│   │   └── LiveBadge.tsx                 # Pulsing live indicator
│   └── ui/
│       ├── index.tsx                     # All shadcn components (consolidated)
│       ├── button.tsx                    # Button variants
│       └── toaster.tsx                   # Toast notifications
└── lib/
    ├── types.ts                          # All TypeScript types
    ├── utils.ts                          # cn(), formatDate(), bracket helpers
    ├── supabase/
    │   ├── client.ts                     # Browser Supabase client
    │   └── server.ts                     # Server Supabase client + getUser()
    ├── bracket/
    │   └── engine.ts                     # generateBracket() algorithm
    └── actions/
        ├── tournaments.ts                # createTournament, generateBracket, togglePublish
        ├── players.ts                    # addPlayer, bulkAdd, updateSeed, delete
        └── matches.ts                    # saveGameScore, deleteGameScore, setMatchLive
```
