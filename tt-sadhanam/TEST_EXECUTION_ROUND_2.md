# COMPREHENSIVE TEST EXECUTION PLAN
## Lead Tester Round - 25 March 2026

---

## TEST MATRIX

### 1. LOADING STATE MANAGEMENT (Critical Fix Validation)
**Status**: Testing loading state cleanup in MultiStageSetup

#### 1.1 Happy Path - Group Assignment
- [ ] Create tournament with 24 players
- [ ] Create Stage 1 with 6 groups (4 per group)
- [ ] Click "Assign Players to Groups"
- [ ] **VERIFY**: Spinner appears immediately
- [ ] **VERIFY**: After 2-3 seconds, spinner disappears
- [ ] **VERIFY**: Success toast appears: "Players assigned to groups"
- [ ] **VERIFY**: Button changes from "Assigning…" back to "Assign Players to Groups"
- [ ] **VERIFY**: UI updates to show groups with assigned players
- **Expected**: ✅ Loading state clears, players assigned successfully

#### 1.2 Happy Path - Fixture Generation
- [ ] From groups_assigned phase, click "Generate Fixtures"
- [ ] **VERIFY**: Spinner appears
- [ ] **VERIFY**: Spinner disappears after operation
- [ ] **VERIFY**: Toast shows: "🗓 Fixtures generated, X matches created"
- [ ] **VERIFY**: Standings table shows group standings with fixtures
- **Expected**: ✅ Loading state clears, fixtures visible

#### 1.3 Happy Path - Stage Creation
- [ ] Start with empty tournament (no stage)
- [ ] Fill config form (4 players per group, 6 groups, bo3, top 2 advance)
- [ ] Click "Create Stage 1"
- [ ] **VERIFY**: Spinner shows briefly
- [ ] **VERIFY**: Toast: "Stage 1 created, 6 groups"
- [ ] **VERIFY**: UI moves to configured phase
- **Expected**: ✅ Loading clears, stage created

#### 1.4 Happy Path - Reset Stage
- [ ] From fixtures phase (with matches), click "Reset Stage"
- [ ] Confirm in dialog
- [ ] **VERIFY**: Spinner appears
- [ ] **VERIFY**: Toast: "Stage 1 reset, All matches and scores cleared"
- [ ] **VERIFY**: Spinner disappears
- [ ] **VERIFY**: UI shows empty standings
- **Expected**: ✅ Loading clears, stage reset

---

### 2. ERROR HANDLING (Critical - 6 scenarios)

#### 2.1 Not Enough Players for Groups
- [ ] Create tournament with 8 players
- [ ] Try to create stage with 6 groups of 4
- [ ] Click "Create Stage 1"
- [ ] **VERIFY**: Error toast appears: "Cannot create stage" + specific error
- [ ] **VERIFY**: Spinner disappears (loading state clears)
- [ ] **VERIFY**: Button re-enables and is clickable
- [ ] **VERIFY**: Form still filled with values (user can retry)
- **Expected**: ✅ Clean error recovery

#### 2.2 Group Assignment with Invalid State
- [ ] Manually corrupt database (remove some groups)
- [ ] Try to assign players
- [ ] **VERIFY**: Error toast: "Group assignment failed"
- [ ] **VERIFY**: Spinner disappears
- [ ] **VERIFY**: Can click "Reconfigure" to start over
- **Expected**: ✅ Graceful error handling

#### 2.3 Fixture Generation Fails
- [ ] Create stage with groups assigned
- [ ] Simulate DB error in fixture generation
- [ ] Click "Generate Fixtures"
- [ ] **VERIFY**: Error toast appears with details
- [ ] **VERIFY**: Spinner clears (setLoading(false) called)
- [ ] **VERIFY**: Can retry or reconfigure
- **Expected**: ✅ Loading state clears on error

#### 2.4 Reset Fails (some corrupted data)
- [ ] Stage with partially corrupted data
- [ ] Click "Reset"
- [ ] **VERIFY**: Error shown, spinner cleared
- [ ] **VERIFY**: User can see what went wrong
- **Expected**: ✅ Graceful degradation

#### 2.5 Multiple Validation Errors
- [ ] Form validation: enter 1 player per group
- [ ] Click "Create Stage 1"
- [ ] **VERIFY**: Error appears: "Cannot create stage"
- [ ] **VERIFY**: Spinner doesn't show (stopped by client validation)
- **Expected**: ✅ Client validation prevents issues

#### 2.6 Server Returns Unexpected Error Format
- [ ] Simulate action returning `{ error: null }` instead of `{ error: "msg" }`
- [ ] **VERIFY**: UI handles gracefully
- **Expected**: ✅ Defensive coding

---

### 3. EDGE CASES & TIMING (12 scenarios)

#### 3.1 Rapid Clicks (Button Mashing)
- [ ] Rapid click "Assign Players" button 5 times quickly
- [ ] **VERIFY**: Only one API call made (button disabled)
- [ ] **VERIFY**: Loading state clears once
- [ ] **VERIFY**: No duplicate data created
- **Expected**: ✅ Concurrency protection works

#### 3.2 Double Click Same Button
- [ ] Click, immediately click again before first completes
- [ ] **VERIFY**: Button disabled during first operation
- [ ] **VERIFY**: Second click doesn't trigger new operation
- **Expected**: ✅ UI prevents double-submission

#### 3.3 Slow Network Simulation (10+ seconds)
- [ ] Network throttle to Slow 4G (Chrome DevTools)
- [ ] Click "Assign Players"
- [ ] Wait 10+ seconds
- [ ] **VERIFY**: Spinner persists but doesn't grow/multiply
- [ ] **VERIFY**: Eventually completes and loading clears
- [ ] **VERIFY**: No timeout error (unless we add timeout protection)
- **Expected**: ⚠️ Works but no progress indication

#### 3.4 Browser Back Button During Operation
- [ ] Click "Assign Players"
- [ ] Immediately click browser back button
- [ ] **VERIFY**: Navigation occurs or warning shown
- [ ] **VERIFY**: No duplicate data from half-completed operation
- **Expected**: ⚠️ Depends on implementation

#### 3.5 Tab Hidden During Operation
- [ ] Click "Assign Players"
- [ ] Switch browser tab
- [ ] Wait 5 seconds, switch back
- [ ] **VERIFY**: Operation continues in background
- [ ] **VERIFY**: UI updates when tab refocused
- **Expected**: ✅ Background operations work

#### 3.6 Component Unmount During Operation
- [ ] Click "Assign Players"
- [ ] Immediately navigate away to different page
- [ ] **VERIFY**: No React warnings in console
- [ ] **VERIFY**: Operation completes (data written to DB)
- **Expected**: ✅ No memory leaks

#### 3.7 Window Resize During Long Operation
- [ ] Start slow operation
- [ ] Resize window
- [ ] **VERIFY**: UI responsive, no re-renders cause issues
- **Expected**: ✅ Works fine

#### 3.8 Keyboard During Operation (Accessibility)
- [ ] Start operation
- [ ] Try pressing Tab, Enter, Space
- [ ] **VERIFY**: Button disabled, no submission
- **Expected**: ✅ Keyboard accessible

#### 3.9 Mobile Viewport During Operation
- [ ] Responsive design test (DevTools mobile)
- [ ] Click button, verify UX on mobile
- [ ] Spinner visible, button disabled properly
- **Expected**: ✅ Mobile UX works

#### 3.10 Rapid Reconfigure/Reset in Sequence
- [ ] Click "Reconfigure"
- [ ] While loading, click "Reset"
- [ ] **VERIFY**: Operations queued or latter canceled
- [ ] **VERIFY**: No conflicting state changes
- **Expected**: ⚠️ Depends on implementation

#### 3.11 LocalStorage/SessionStorage Issues
- [ ] Clear browser storage
- [ ] Perform operations
- [ ] **VERIFY**: App still works (doesn't depend on storage)
- **Expected**: ✅ Works fine

#### 3.12 Multiple Admin Tabs (Same Tournament)
- [ ] Open same tournament in 2 browser tabs
- [ ] Admin A: Click "Assign Players"
- [ ] Admin B (simultaneously): Click "Create Fixture"
- [ ] **VERIFY**: Operations don't conflict
- [ ] **VERIFY**: Last write wins or conflict detected
- **Expected**: ⚠️ Need concurrency control

---

### 4. DATA CONSISTENCY (12 scenarios)

#### 4.1 Verify Groups Actually Created
- [ ] Create stage with 6 groups
- [ ] Query database: `SELECT * FROM rr_group WHERE stage_id = ...`
- [ ] **VERIFY**: 6 rows exist
- **Expected**: ✅ Groups created

#### 4.2 Verify Players Assigned to Groups
- [ ] Assign 24 players to 6 groups
- [ ] Query: `SELECT * FROM rr_group_members WHERE group_id = ...`
- [ ] **VERIFY**: 4 players per group, all 24 accounted for
- **Expected**: ✅ Assignment correct

#### 4.3 No Duplicate Assignments
- [ ] Check for same player_id in multiple groups
- [ ] **VERIFY**: Each player appears exactly once
- **Expected**: ✅ No duplicates

#### 4.4 Group Distribution Fair
- [ ] After assignment, check group sizes
- [ ] With 24 players and 6 groups: 4 per group
- [ ] Verify no group < 2 players, no group > 4 players
- **Expected**: ✅ Fair distribution

#### 4.5 Fixtures Math Correct
- [ ] 6 groups of 4 with round-robin
- [ ] Expected matches = C(4,2) * 6 = 6*6 = 36 matches
- [ ] **VERIFY**: Exactly 36 matches created
- **Expected**: ✅ Correct count

#### 4.6 All Players Have Fixtures
- [ ] Count which players appear in matches
- [ ] **VERIFY**: All 24 players are in fixture list
- **Expected**: ✅ No players missed

#### 4.7 Reset Actually Clears
- [ ] After reset, query database
- [ ] `SELECT * FROM match WHERE stage_id = ...`
- [ ] **VERIFY**: No matches exist
- [ ] `SELECT * FROM rr_group_members`
- [ ] **VERIFY**: Groups still exist, members cleared
- **Expected**: ✅ Data properly cleaned

#### 4.8 No Orphaned Rows After Reset
- [ ] Check all related tables after reset
- [ ] Player scores, group settings, match details
- [ ] **VERIFY**: No dangling foreign keys
- **Expected**: ✅ Clean cascade deletes

#### 4.9 Stage Only Deletable in Correct Phase
- [ ] Try "Reconfigure" in different phases
- [ ] cannot_configured: Should work
- [ ] fixtures: Should fail with "has scores"
- **VERIFY**: Proper business logic enforcement
- **Expected**: ✅ Phase locks work

#### 4.10 Config Immutable After Assignment
- [ ] Assign players
- [ ] Try to change group count
- [ ] **VERIFY**: Change rejected (can only reconfigure)
- **Expected**: ✅ Lock working

#### 4.11 No Partial Writes
- [ ] Stop operation mid-flight (kill connection)
- [ ] **VERIFY**: Either all groups written or none
- **Expected**: ⚠️ Depends on transaction handling

#### 4.12 Foreign Key Constraints Enforced
- [ ] Manually delete a group
- [ ] Try to assign players to it
- [ ] **VERIFY**: DB rejects with foreign key error
- **Expected**: ✅ Constraint enforced

---

### 5. UI/UX FEEDBACK (12 scenarios)

#### 5.1 Toast Messages Clear
- [ ] Success toast appears
- [ ] Wait 5+ seconds
- [ ] **VERIFY**: Toast auto-dismisses
- **Expected**: ✅ Toast visible long enough

#### 5.2 Toast Message Readable
- [ ] Check all toast messages for clarity
- [ ] Error messages include specific details
- [ ] **SUCCESS**: "Players assigned to groups" ✓
- [ ] **EXPECTED**: Error: "Group 5 has only 1 player..." (specific)
- **Expected**: ✅ Clear feedback

#### 5.3 Button Text Updates
- [ ] Before click: "Assign Players to Groups"
- [ ] During: "Assigning…"
- [ ] After: "Assign Players to Groups"
- [ ] **VERIFY**: Text changes appropriately
- **Expected**: ✅ Loading text shown

#### 5.4 Button States Correct
- [ ] enabled → disabled (during op) → enabled (after)
- [ ] On error, button re-enables
- [ ] **VERIFY**: Can click to retry
- **Expected**: ✅ State transitions work

#### 5.5 Loading Indicator Visual
- [ ] Spinner visible while loading
- [ ] Spin animation smooth
- [ ] Positioned correctly (not overlapping)
- [ ] **VERIFY**: Clear visual feedback
- **Expected**: ✅ UX clear

#### 5.6 Disabled Button Appearance
- [ ] Button appears greyed out while disabled
- [ ] Cursor changes to not-allowed
- [ ] **VERIFY**: Clear that it's disabled
- **Expected**: ✅ Visual feedback works

#### 5.7 Error Toast Highlight
- [ ] Error toast has different color/style
- [ ] **VERIFY**: Visually distinct from success
- **Expected**: ✅ Danger variant shows

#### 5.8 Confirmation Dialog Required
- [ ] "Reset Stage" asks for confirmation
- [ ] **VERIFY**: Can cancel
- [ ] **VERIFY**: Confirm triggers operation
- **Expected**: ✅ Prevents accidental actions

#### 5.9 Phase Indicator Clear
- [ ] "Stage is configured" message shows
- [ ] Shows player count, group count
- [ ] Shows top advancer count
- [ ] **VERIFY**: User knows what's next
- **Expected**: ✅ Clear status

#### 5.10 No Confusing States
- [ ] During operation, only spinner shows
- [ ] Not: spinner + loading skeleton + something else
- [ ] **VERIFY**: Single clear loading state
- **Expected**: ✅ Clean UX

#### 5.11 Accessibility - Screen Reader
- [ ] Button has aria-label describing action
- [ ] Loading state announced
- [ ] Error message read aloud
- **Expected**: ✅ Accessibility good (if implemented)

#### 5.12 Mobile-Friendly Toasts
- [ ] On mobile, toast doesn't cover essential UI
- [ ] Can dismiss toast
- [ ] **VERIFY**: Not blocking interaction
- **Expected**: ✅ Mobile UX works

---

### 6. CONCURRENT OPERATIONS (8 scenarios)

#### 6.1 Two Admins Create Stage Simultaneously
- [ ] Admin A: Fill form, click Create
- [ ] Admin B: Fill form, click Create (same tournament)
- [ ] **VERIFY**: One succeeds, one fails (or race handled)
- **Expected**: ⚠️ May need conflict detection

#### 6.2 Admin Assigns While Another Generates Fixtures
- [ ] Stadium A: Click "Assign Players"
- [ ] Stadium B (same tournament, simultaneously): Click "Generate Fixtures"
- [ ] **VERIFY**: Operations serialize (not concurrent)
- **Expected**: ⚠️ Depends on locking

#### 6.3 Reset While Assign In-Flight
- [ ] Click "Assign Players"
- [ ] Immediately click "Reset"
- [ ] **VERIFY**: Reset waits or is rejected
- **Expected**: ⚠️ Need operation queuing

#### 6.4 Navigate Away While Save In-Flight
- [ ] Click "Assign Players"
- [ ] Immediately click back button/navigate
- [ ] **VERIFY**: Operation still completes in background
- [ ] **VERIFY**: Data is saved
- **Expected**: ✅ Background persistence works

#### 6.5 Tab Not Reloaded - Sees Stale Data
- [ ] Admin A: Assign players
- [ ] Admin B (different tab, not reloaded): Still shows old phase
- [ ] Admin B refreshes
- [ ] **VERIFY**: Shows updated state
- **Expected**: ⚠️ Multiple tabs need refresh

#### 6.6 Rate Limiting (if implemented)
- [ ] Rapid API calls (form submit 10x quickly)
- [ ] **VERIFY**: Later calls fail gracefully with rate limit message
- **Expected**: ⚠️ May not be implemented

#### 6.7 Offline -> Online During Operation
- [ ] Start operation
- [ ] Toggle offline mode
- [ ] Toggle back online
- [ ] **VERIFY**: Operation completes or proper error
- **Expected**: ⚠️ Depends on implementation

#### 6.8 Service Worker Cache Issues
- [ ] PWA caching old UI
- [ ] Create stage, refresh (should show new state)
- [ ] **VERIFY**: Fresh server state shown
- **Expected**: ⚠️ May need cache busting

---

## EXECUTION LOG

[To be filled during testing]

---

## FINDINGS SUMMARY

### Critical Issues Found
[List of bugs/issues preventing launch]

### High Priority Issues
[Functionality works but UX could be better]

### Medium Priority Issues
[Edge cases, concurrency handling]

### Low Priority Issues
[Nice-to-have improvements]

### Verified Working ✅
[Features confirmed working]

---

## SIGN-OFF

**Lead Tester**: AI Assistant  
**Date**: 25 March 2026  
**Test Coverage**: 60+ scenarios  
**Status**: [PENDING/PASSING/FAILING]
