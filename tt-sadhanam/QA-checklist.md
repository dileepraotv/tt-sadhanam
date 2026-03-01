# TT-SADHANAM — Manual QA Test Checklist
**Version**: v3.x (Multi-stage / RR / KO)
**Instructions**: Work through each section in order. Check ✅ or mark ❌ with notes.
Use two browser tabs — one admin, one public — for realtime tests.

---

## 0. Environment Setup

| # | Step | Expected |
|---|------|----------|
| 0.1 | Run `npm run dev` | Server starts, no TypeScript errors |
| 0.2 | Open admin tab: `http://localhost:3000` | Sign-in page loads |
| 0.3 | Sign in with admin credentials | Redirects to `/admin` or `/` |
| 0.4 | Open public tab: `http://localhost:3000` | Public home loads |
| 0.5 | Toggle dark mode | Colors switch; no flash; localStorage persists on reload |

---

## 1. Single Knockout (KO)

**Setup**: Create tournament, format = Single Knockout.

### 1.1 Seeding & Bracket Generation

| # | Action | Expected |
|---|--------|----------|
| 1.1.1 | Add 8 players, seeds 1–8 | Players appear in Players tab ordered by seed |
| 1.1.2 | Click "Generate Draw" | Bracket generated, redirected to Bracket tab |
| 1.1.3 | Check Round 1 pairings | Seed 1 vs Seed 8, Seed 2 vs Seed 7, Seed 3 vs Seed 6, Seed 4 vs Seed 5 (complement-interleave) |
| 1.1.4 | Seed 1 is always on a different half from Seed 2 | Full Draw shows they can only meet in Final |
| 1.1.5 | Add 1 more player → 9 players total, re-generate | 9-player bracket has 7 BYE slots → size 16; 7 byes assigned |

### 1.2 BYE Handling

| # | Action | Expected |
|---|--------|----------|
| 1.2.1 | Generate 5-player bracket | 3 first-round matches: 2 real, 3 BYEs (bracket size = 8) |
| 1.2.2 | Check BYE match display | Card shows "BYE" label, greyed/dimmed appearance |
| 1.2.3 | BYE match auto-advances winner | Winner already shown in next round before any scoring |
| 1.2.4 | Check that BYE matches are NOT counted in "Matches" stat | StatusTile shows only real matches |

### 1.3 Score Entry & Advancement

| # | Action | Expected |
|---|--------|----------|
| 1.3.1 | Click a pending match → open scoring page | Correct player names; format matches tournament setting |
| 1.3.2 | Mark as Live | Status chip shows "LIVE"; admin match count badge updates |
| 1.3.3 | Enter score 11–5 (Game 1) and save | Game chip appears in bracket: "11–5" |
| 1.3.4 | Complete match (e.g. 2–0 in BO3) | Match shows "Done"; winner highlighted with trophy 🏆 |
| 1.3.5 | Winner auto-advances to next round | Next round match now shows winner's name in correct slot |
| 1.3.6 | Complete all matches through to Final | Tournament status changes to "Complete"; winner shown |

### 1.4 Reset KO Bracket

| # | Action | Expected |
|---|--------|----------|
| 1.4.1 | Click "Re-generate Draw" after scoring a match | ResetStageDialog opens |
| 1.4.2 | Dialog shows match stats | Shows "X matches, Y game results" |
| 1.4.3 | With completed match: "Type RESET to confirm" appears | Input appears; button disabled until typed |
| 1.4.4 | Type "RESET" and confirm | Bracket cleared; toast shows counts; fresh bracket generated |

---

## 2. Single Round Robin (RR)

**Setup**: Create tournament, format = Single Round Robin.

### 2.1 Group Configuration

| # | Action | Expected |
|---|--------|----------|
| 2.1.1 | Select 2 groups, Top 2, BO3, no best-third | "4 total qualifiers" preview pill shown |
| 2.1.2 | With only 5 players — select 2 groups, Top 3 | Config invalid: "Need ≥ 8 players (have 5)" warning |
| 2.1.3 | Add 8 players, submit config | Stage created; stepper advances to "Assign Players" |

### 2.2 Player Assignment (Snake Seeding)

| # | Action | Expected |
|---|--------|----------|
| 2.2.1 | Click "Assign Players to Groups" | Players distributed; stepper → "Generate Schedule" |
| 2.2.2 | 8 players, 2 groups → Group A: seeds 1, 4, 5, 8; Group B: seeds 2, 3, 6, 7 | Snake order: 1→A, 2→B, 3→B, 4→A, 5→A, 6→B, 7→B, 8→A |
| 2.2.3 | 3 unseeded players + 5 seeded → unseeded go to groups last | Seeded players distributed first, unseeded appended |

### 2.3 Schedule Generation

| # | Action | Expected |
|---|--------|----------|
| 2.3.1 | Click "Generate RR Schedule" | Fixtures created; toast shows match count |
| 2.3.2 | N players in a group → N*(N-1)/2 matches per group | 4-player group = 6 fixtures; 3-player group = 3 fixtures |
| 2.3.3 | No player plays twice in the same round | Each matchday has each player exactly once (or BYE in odd groups) |
| 2.3.4 | No duplicate fixtures | Player A vs B appears exactly once across all rounds |

### 2.4 Standings Correctness

Set up a group and manually enter results:

**Test scenario** — 4 players (A, B, C, D) in one group, BO3:

| Match | Result | Winner |
|-------|--------|--------|
| A vs B | 2–0 | A |
| C vs D | 2–1 | C |
| A vs C | 1–2 | C |
| B vs D | 2–0 | B |
| A vs D | 2–1 | A |
| B vs C | 2–0 | B |

| # | Check | Expected |
|---|-------|----------|
| 2.4.1 | Standings order | 1st: B (3W), 2nd: C (2W), 3rd: A (2W), 4th: D (0W) |
| 2.4.2 | A and C both have 2 wins — tiebreaker | H2H: C beat A → C ranks above A |
| 2.4.3 | MP column for each player | Should be 3 (played all) |
| 2.4.4 | Game difference (GD) | B: +4; C: 0; A: -1; D: -3 |
| 2.4.5 | Qualifier divider line | Appears after row 2 (top 2 advance default) |
| 2.4.6 | Green rows | Top 2 (B, C) have green background/trophy |
| 2.4.7 | Live updates | Enter a score in admin tab → public tab standings update without refresh |

### 2.5 Tiebreaker Chain

| # | Scenario | Expected Tiebreaker Used |
|---|----------|--------------------------|
| 2.5.1 | A and B have same wins | H2H (if only 2 tied): whoever won A vs B |
| 2.5.2 | A, B, C all have same wins | Skip H2H (3-way tie) → game difference |
| 2.5.3 | A and B same wins, same GD | Points difference (total points scored) |
| 2.5.4 | All same wins, GD, PD | Stable sort by player UUID (deterministic) |
| 2.5.5 | Tiebreaker tooltip | Hover rank in admin standings → shows reason (e.g. "H2H: beat B") |

### 2.6 Match Fixtures List

| # | Check | Expected |
|---|-------|----------|
| 2.6.1 | Matchday accordion shows correct round groupings | Round 1 = matchday 1 fixtures, etc. |
| 2.6.2 | Live match has pulse dot | Animated orange dot visible |
| 2.6.3 | Completed match shows score chips | "11–8 · 11–6" chips on fixture row |
| 2.6.4 | Clicking fixture opens MatchDetailDialog | Dialog shows game-by-game breakdown |

---

## 3. Multi-Stage (Groups → Knockout)

**Setup**: Create tournament, format = Multi-stage Groups → KO. Add 8 players.

### 3.1 Stage 1 Setup (same as §2.1–2.3)

Follow §2.1–2.3. When complete, standings should be visible.

### 3.2 Finalization Rules

#### 3.2.1 `require_all` (default)

| # | Action | Expected |
|---|--------|----------|
| 3.2.1.1 | Leave 1 match incomplete, try to advance | "Advance" button is disabled; error if forced |
| 3.2.1.2 | Complete ALL matches | "Close Stage 1 & Advance" button becomes active |
| 3.2.1.3 | Click advance → confirm dialog | Qualifier count shown; locked after confirm |
| 3.2.1.4 | Stage 1 closed | Stepper shows "Done"; standings frozen |

#### 3.2.2 `manual` (override enabled)

| # | Action | Expected |
|---|--------|----------|
| 3.2.2.1 | Configure stage with "Manual override" finalization rule | Summary tile shows "Manual override" badge |
| 3.2.2.2 | Enter partial results (leave 2 matches unplayed) | "Finalize Group Stage" amber button appears |
| 3.2.2.3 | Click "Finalize Group Stage" | FinalizeStage1Dialog opens |
| 3.2.2.4 | Dialog shows correct counts | e.g. "2/6 matches still pending" |
| 3.2.2.5 | Must type "FINALIZE" to enable button | Button disabled until typed correctly |
| 3.2.2.6 | Confirm finalization | Stage closes; toast shows "2 incomplete matches skipped"; KO bracket generated |
| 3.2.2.7 | Incomplete matches are locked | Cannot enter scores on them; scoring page shows locked state |

### 3.3 Qualifier Computation

| # | Scenario | Expected |
|---|----------|----------|
| 3.3.1 | 2 groups, Top 2, no best-third | 4 qualifiers → KO bracket size = 4 |
| 3.3.2 | 3 groups, Top 2, + 2 best-thirds | 8 qualifiers → KO bracket size = 8 |
| 3.3.3 | Group A winner gets KO Seed 1 | Snake order: A1→#1, B1→#2, C1→#3, A2→#4, B2→#5 |
| 3.3.4 | Same-group R1 avoidance | No two players from the same RR group are paired in Round 1 of KO (if avoidable) |
| 3.3.5 | Best-third selection | Best-thirds ranked by: wins → game_diff → points_diff → UUID |

### 3.4 Stage 2 Bracket Lock

| # | Check | Expected |
|---|-------|----------|
| 3.4.1 | Stage 2 section greyed/locked until Stage 1 complete | Lock icon visible; opacity reduced |
| 3.4.2 | "Generate Knockout" button only appears after stage1_complete=true | |
| 3.4.3 | Once KO bracket generated, Stage 1 standings are read-only | No score entry possible on RR matches |

### 3.5 KO Bracket Reset (Multi-stage)

| # | Action | Expected |
|---|--------|----------|
| 3.5.1 | After Stage 2 generated, enter 1 KO result | Match shows score |
| 3.5.2 | Click "Reset KO Bracket" button | ResetStageDialog opens with KO stats |
| 3.5.3 | Has completed match → typed confirm required | "Type RESET to confirm" input |
| 3.5.4 | Confirm reset | KO bracket deleted; Stage 1 data intact; stage1_complete still true |
| 3.5.5 | "Generate Knockout from Qualifiers" re-appears | Can regenerate without redoing Stage 1 |

### 3.6 Stage 1 Reset (with cascade)

| # | Action | Expected |
|---|--------|----------|
| 3.6.1 | With both stages complete, click "Reset Stage 1" | Dialog warns "KO bracket will also be cleared" (extraWarning) |
| 3.6.2 | Confirm reset | Both stages cleared; tournament back to stage setup |
| 3.6.3 | Toast shows audit log | "X matches and Y game results deleted" |

---

## 4. Realtime — Public View Updates

Open two tabs:
- **Tab A** (admin): `/admin/tournaments/[id]`
- **Tab B** (public): `/tournaments/[id]`

### 4.1 Live Match Strip

| # | Action in Tab A | Expected in Tab B |
|---|-----------------|-------------------|
| 4.1.1 | Mark a KO match as Live | LiveNowStrip appears at top with player names |
| 4.1.2 | Enter game score (11–8) | Score chips on strip update without page refresh |
| 4.1.3 | Complete match | Strip disappears or updates to "FINAL" |
| 4.1.4 | Mark 3 matches live | All 3 appear in horizontally scrollable strip |

### 4.2 Bracket Realtime

| # | Action in Tab A | Expected in Tab B |
|---|-----------------|-------------------|
| 4.2.1 | Start a KO match (mark live) | BracketView card gets orange live border + pulse bar |
| 4.2.2 | Score a game | Game chip updates on bracket card |
| 4.2.3 | Complete match | Bracket card goes grey; winner shows trophy 🏆 |
| 4.2.4 | Winner advances | Next round slot updates with winner's name |

### 4.3 RR Standings Realtime

| # | Action in Tab A | Expected in Tab B |
|---|-----------------|-------------------|
| 4.3.1 | Enter complete result for a RR match | Standings table reorders correctly without refresh |
| 4.3.2 | Create a tie situation then resolve it | Standings reflect tiebreaker in real time |
| 4.3.3 | Match goes live | Group tab shows live pulse dot |
| 4.3.4 | All group matches complete | Group tab shows ✓ completion badge |

### 4.4 Connection State

| # | Test | Expected |
|---|------|----------|
| 4.4.1 | Connection dot in public hero | Green = connected; pulse animation |
| 4.4.2 | Simulate disconnect (stop server) | Dot turns to muted/grey, optional "reconnecting" state |
| 4.4.3 | Reconnect (restart server) | Dot returns green; latest state loads |

---

## 5. Safety & Edge Cases

### 5.1 Reset Guards

| # | Scenario | Expected |
|---|----------|----------|
| 5.1.1 | Reset stage with no matches yet | Dialog opens (stageId provided but 0 stats); confirm resets cleanly |
| 5.1.2 | Reset stage with only fixtures (no scores) | No typed confirm required; resets instantly |
| 5.1.3 | Reset stage with completed matches | "Type RESET" input required; shows exact count |
| 5.1.4 | Cancel reset mid-type | Dialog closes; stage unaffected |
| 5.1.5 | Two admins: one resets while other is scoring | Score entry gets a "tournament not found or not started" error gracefully |

### 5.2 Format Type Guards

| # | Scenario | Expected |
|---|----------|----------|
| 5.2.1 | Change format type BEFORE bracket generated | Allowed; type changes immediately |
| 5.2.2 | Try to change format AFTER bracket generated | TournamentTypeSelector shows locked state with tooltip |
| 5.2.3 | Single RR completion → tournament status = complete | Status changes on last match completion |

### 5.3 Boundary Cases

| # | Scenario | Expected |
|---|----------|----------|
| 5.3.1 | Generate KO bracket with 2 players | 1 match (the Final); correct |
| 5.3.2 | Generate KO bracket with 64 players | 6 rounds generated; no JS errors |
| 5.3.3 | RR group with 2 players | 1 match per group; valid |
| 5.3.4 | 3-player RR group (odd) | Circle method adds virtual BYE; 3 rounds, 1 match per round |
| 5.3.5 | advanceCount ≥ group size | Config panel shows "Need more players" warning |
| 5.3.6 | Re-generate RR schedule without re-assigning players | Players stay in groups; new fixture set created cleanly |

### 5.4 Auth / Ownership

| # | Scenario | Expected |
|---|----------|----------|
| 5.4.1 | Attempt resetStage for another user's tournament via devtools | Server returns "Tournament not found" (ownership check) |
| 5.4.2 | Public user opens admin URL `/admin/tournaments/[id]` | Redirected to sign-in or 404 |
| 5.4.3 | Non-owner admin signs in, visits tournament | Gets 404 redirect (no data returned) |

---

## 6. Dark Mode Visual QA

With dark mode enabled:

| # | Check |
|---|-------|
| 6.1 | All card surfaces clearly separated from background |
| 6.2 | Tab strip visible as a container (darker than surrounding card) |
| 6.3 | Active tab has visible ring/shadow |
| 6.4 | Muted text readable (no near-invisible grey-on-dark) |
| 6.5 | Orange accents not vibrating — used for badges/borders, not large fills |
| 6.6 | ResetStageDialog stat rows: red text visible, not harsh |
| 6.7 | FinalizeStage1Dialog amber warning readable |
| 6.8 | Completion progress bar (orange) visible on dark muted track |
| 6.9 | SummaryTile with "Manual override" highlight visible (amber on dark) |
| 6.10 | BracketView connector lines visible (border token) |

---

## 7. Smoke Test — Full Walkthrough

The fastest complete test of every code path:

1. **Create** new multi-stage tournament, 8 players, 2 groups, Top 2, BO3, Manual finalize rule
2. **Assign** players → verify snake seeding in Group A/B
3. **Generate** schedule → verify 6 fixtures per group
4. **Score** 10/12 matches (leave 2 pending)
5. **Verify** standings update in real time on public tab
6. **Force-finalize** via "Finalize Group Stage" button → type FINALIZE → confirm
7. **Verify** Stage 2 KO bracket appears with 4 players
8. **Score** 2 KO matches → check bracket advancement
9. **Reset KO bracket** → verify Stage 1 data intact
10. **Regenerate KO** → verify clean bracket
11. **Complete KO** through Final → verify champion shown
12. **Reset Stage 1** → verify cascade wipes Stage 2 → toast shows counts
13. Toggle **dark mode** throughout — verify no visual regressions

---

## 8. Known Limitations & Deferred Items

| Item | Status |
|------|--------|
| Email notifications on match start/result | Not implemented |
| Persistent audit log table in DB | Logs returned in-memory per request only; not stored in DB |
| Undo last score entry | Not implemented; use Delete button per game |
| Multi-admin concurrent editing | Last-write-wins; no conflict detection |
| Court scheduling / time slots | Not implemented |
| Mobile scoring (touch targets) | Tested up to 375px width; works |
