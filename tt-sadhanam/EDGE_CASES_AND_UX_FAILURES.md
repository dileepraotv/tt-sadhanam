# Edge Cases & UX Failure Modes - Tournament Admin UI

**Problem**: Test suite was too narrow and missed a critical loading state bug. This document catalogs all the ways the multi-stage tournament setup can break.

---

## 1. STATE MANAGEMENT FAILURES (18 scenarios)

### ✅ 1.1 Hanging/Infinite Loaders
- **Scenario**: User clicks "Assign Players to Groups", sees spinner forever
- **Root Cause**: `setLoading(true)` called, `setLoading(false)` never executed
- **Status**: FIXED in commit c04fb45
- **Test**: Should verify `setLoading(false)` in finally block
- **UX Impact**: CRITICAL - user thinks app is frozen

### ⚠️ 1.2 Server Action Timeout
- **Scenario**: `generateGroups()` takes >30 seconds, user assumes it failed
- **Symptoms**: Spinner continues indefinitely despite long delay
- **Solution**: Add timeout wrapper, show "Still processing..." after 5s
- **Test**: Mock slow operation (10+ seconds), verify cleanup still happens
- **UX Impact**: HIGH - bad user perception

### ⚠️ 1.3 Network Error During Operation
- **Scenario**: Network drops mid-`generateGroups()`, method throws exception
- **Current**: Exception not caught, loading state leaks
- **Solution**: Wrap in try/catch, ensure finally block executes
- **Test**: Mock rejection, verify setLoading(false) still called
- **UX Impact**: HIGH - user blocked indefinitely

### ⚠️ 1.4 Race Condition - Multiple Submissions
- **Scenario**: User impatient, clicks "Assign Players" button 3 times rapidly
- **Issue**: Multiple async operations start, last one wins (or reader-writer conflict)
- **Solution**: Button disabled during `isPending`, prevent multiple submissions
- **Test**: Rapid clicks, verify only one actual server action called
- **UX Impact**: MEDIUM - potential data corruption

### ⚠️ 1.5 Unhandled Exception in Server Action
- **Scenario**: `generateGroups()` throws `new Error("Unexpected DB error")` instead of returning `{ error: "..." }`
- **Current**: Exception bubbles up, setLoading never clears
- **Solution**: All server actions must return error object, never throw
- **Test**: Mock throw, verify loading state clears and error toast appears
- **UX Impact**: CRITICAL - complete freeze

### ⚠️ 1.6 Partial Transaction Success
- **Scenario**: Groups created and assigned ✓, but fixtures generation in same action fails
- **Issue**: Database has partial state, UI unclear on what succeeded
- **Solution**: Clear return value indicating partial success with what was/wasn't done
- **Test**: Mock partial success response, verify UI shows accurate status
- **UX Impact**: MEDIUM - confusion about what completed

### ⚠️ 1.7 Button State Desync
- **Scenario**: `isPending` clears but `setLoading` doesn't, or vice versa
- **Issue**: Button re-enables (looks clickable) but spinner still shows
- **Solution**: Both must clear in same transaction
- **Test**: Verify isPending and setLoading both clear simultaneously
- **UX Impact**: MEDIUM - confusing UI

### ⚠️ 1.8 Component Unmount During Async
- **Scenario**: User navigates away or closes modal while `generateFixtures()` in flight
- **Issue**: Callback tries to `setState()` on unmounted component (React warning)
- **Solution**: Add cleanup/abort pattern, check component mounted before setState
- **Test**: Render → click button → unmount before promise resolves
- **UX Impact**: LOW - just dev console warnings

### ⚠️ 1.9 Modal Closes But Operation Continues
- **Scenario**: User clicks X to close setup modal, but `generateGroups()` still uploading
- **Issue**: User thinks it's cancelled, operation continues in background
- **Solution**: Confirm before closing if operation in-flight
- **Test**: Modal close while operation pending, verify warning
- **UX Impact**: MEDIUM - silent data creation

### ⚠️ 1.10 Error State Doesn't Reset
- **Scenario**: Operation fails with error, user doesn't see recovery path
- **Issue**: Button disabled, can't retry or reconfigure
- **Solution**: Show "Retry" button or clear button state after error
- **Test**: Error → button should be re-clickable
- **UX Impact**: MEDIUM - user stuck

### ⚠️ 1.11 Multiple Admins Concurrent Operations
- **Scenario**: Admin A assigns players, Admin B generates fixtures at same time
- **Issue**: Race condition, last write wins, data inconsistency
- **Solution**: Add optimistic locking or version fields
- **Test**: Simulate concurrent actions (hard in Jest)
- **UX Impact**: HIGH - data corruption

### ⚠️ 1.12 Slow Network - No Feedback
- **Scenario**: 3G connection, operation takes 30 seconds, but UI silent
- **Issue**: User doesn't know what's happening
- **Solution**: Show elapsed time, "Still processing..." after 5 seconds
- **Test**: Mock 10+ second delay, verify additional feedback shown
- **UX Impact**: MEDIUM - poor UX

### ⚠️ 1.13 Rapid Reconfigure/Reset Attempts
- **Scenario**: User clicks "Reconfigure", then before it completes, clicks "Reset"
- **Issue**: Two conflicting operations fighting over stage state
- **Solution**: Queue operations or prevent secondary operations while pending
- **Test**: Mock slow reconfigure, click reset while pending
- **UX Impact**: MEDIUM - data consistency risk

### ⚠️ 1.14 Callback Closure Bug
- **Scenario**: `startTransition` closure captures stale `stage` reference
- **Issue**: Wrong stage ID sent to server action
- **Solution**: Verify closure doesn't capture stale values
- **Test**: Change stage mid-operation, verify correct ID used
- **UX Impact**: MEDIUM - wrong data modified

### ⚠️ 1.15 Memory Leak - Async After Unmount
- **Scenario**: Component unmounts while async operation pending
- **Issue**: setLoading() called after component gone, React warning
- **Solution**: AbortController pattern or useEffect cleanup
- **Test**: Unmount during operation, check for React warnings
- **UX Impact**: LOW - dev console noise

### ⚠️ 1.16 Browser Back Button During Operation
- **Scenario**: User hits browser back while `generateGroups()` running
- **Issue**: Navigation happens but operation continues, data consistency unclear
- **Solution**: Prevent back button or show confirmation
- **Test**: Back button while pending
- **UX Impact**: MEDIUM - unclear state

### ⚠️ 1.17 Tab Hidden - Async Continues
- **Scenario**: User switches tabs while operation running, comes back 2 minutes later
- **Issue**: Operation finished but hidden, user doesn't see success/error
- **Solution**: Store operation result, show on tab refocus
- **Test**: Hide tab, wait, show tab, verify UI consistent
- **UX Impact**: MEDIUM - missed feedback

### ⚠️ 1.18 Toast Auto-Dismiss Before Reading
- **Scenario**: Success toast appears for 3 seconds, disappears before user reads it
- **Issue**: User unsure if operation succeeded
- **Solution**: Longer timeout, clickable toast, or persist in history
- **Test**: Verify toast timeout, maybe extend for important operations
- **UX Impact**: LOW - user can refresh to check

---

## 2. DATA CONSISTENCY ISSUES (12 scenarios)

### ⚠️ 2.1 Players Assigned But Groups Don't Exist
- **Scenario**: DB corruption - `rr_group_members` rows point to non-existent `rr_group` IDs
- **Root Cause**: Stage created, then groups deleted, then assignment attempted
- **Solution**: Foreign key constraints, transactional integrity
- **Test**: Mock DB state inconsistency, verify error handling
- **UX Impact**: HIGH - broken tournament state

### ⚠️ 2.2 Groups Exist But No Fixtures Generated
- **Scenario**: 6 groups created, players assigned, but no matches in DB
- **Cause**: Fixture generation skipped or timed out
- **Solution**: Detect incomplete state, show warning
- **Test**: Partial data state scenarios
- **UX Impact**: MEDIUM - tournament can't proceed

### ⚠️ 2.3 Fixtures Missing Some Players
- **Scenario**: Group 1 has 4 players, generates 5 matches instead of 6
- **Cause**: Circle-method scheduler algorithm bug or off-by-one
- **Solution**: Validation after fixture generation
- **Test**: Math verification of match count
- **UX Impact**: MEDIUM - unfair tournament

### ⚠️ 2.4 Reset Doesn't Actually Clear Data
- **Scenario**: User clicks "Reset Stage", confirmation shown, but matches still exist
- **Cause**: SQL DELETE statement failed silently
- **Solution**: Verify DELETE succeeded before showing success toast
- **Test**: Reset, check DB actually empty
- **UX Impact**: HIGH - confusing state

### ⚠️ 2.5 Orphaned Database Rows
- **Scenario**: Stage1 deleted but `rr_group` rows orphaned (no `stage_id` match)
- **Cause**: Cascading delete failed
- **Solution**: ON DELETE CASCADE constraints
- **Test**: Delete stage, verify cleanup
- **UX Impact**: MEDIUM - data bloat

### ⚠️ 2.6 Foreign Key Violation on Assignment
- **Scenario**: Trying to assign player to group that no longer exists
- **Cause**: Group deleted between page load and assignment
- **Solution**: Reload data before operation, check constraints
- **Test**: Concurrent deletion + assignment
- **UX Impact**: MEDIUM - error but recoverable

### ⚠️ 2.7 Duplicate Player in Group
- **Scenario**: Player assigned to same group twice (unique constraint missing)
- **Cause**: Assignment algorithm bug or concurrency
- **Solution**: Unique constraint on (group_id, player_id)
- **Test**: Verify constraint exists
- **UX Impact**: MEDIUM - unfair scores

### ⚠️ 2.8 Partial Database Commit
- **Scenario**: First 100 groups assigned, but 50th player causes error, partial rollback
- **Cause**: Transaction not properly atomic
- **Solution**: Ensure all-or-nothing semantics
- **Test**: Simulate error mid-operation
- **UX Impact**: HIGH - broken state

### ⚠️ 2.9 Config Changed During Assignment
- **Scenario**: Stage has 6 groups configured, but assignment algorithm assumes 4
- **Cause**: Config updated between reads
- **Solution**: Lock stage config during assignment
- **Test**: Config change mid-operation
- **UX Impact**: MEDIUM - wrong behavior

### ⚠️ 2.10 New Players Added After Stage Created
- **Scenario**: Stage created with 24 players, then 2 more joined, assignment uses only 24
- **Cause**: Stale data load
- **Solution**: Reload players before assignment
- **Test**: Mock new players after stage creation
- **UX Impact**: MEDIUM - unfair inclusion

### ⚠️ 2.11 Group Count Mismatches
- **Scenario**: Config says 6 groups, but assignment only fills 4 groups
- **Cause**: Algorithm or player count mismatch
- **Solution**: Validation that ppg * numGroups ≈ playerCount
- **Test**: Math validation
- **UX Impact**: MEDIUM - unfair distribution

### ⚠️ 2.12 Player Count Exceeds Group Capacity
- **Scenario**: 25 players into 6 groups of 4 max = impossible
- **Cause**: UI allowed invalid configuration
- **Solution**: Front-end validation during config form
- **Test**: Form validation
- **UX Impact**: MEDIUM - error on submit instead of during config

---

## 3. UI/UX ISSUES (12 scenarios)

### ✅ 3.1 Spinning Loader Persists Indefinitely
- **Scenario**: [THE BUG] User clicks assign, sees spinner forever
- **Status**: FIXED in c04fb45
- **Test**: Verify setLoading(false) called

### ⚠️ 3.2 Button Stays Disabled After Error
- **Scenario**: Assignment fails, button text changes to "Could not assign..." and stays greyed out
- **Issue**: `isPending` clears but disabled state bound to loading flag
- **Solution**: Verify button disabled only during operation, not after error
- **Test**: Error scenario, button should be clickable
- **UX Impact**: MEDIUM - user can't retry

### ⚠️ 3.3 Toast Disappears Too Quickly
- **Scenario**: Success toast shows for 3 seconds, user didn't read it
- **Solution**: 5-8 second timeout, or persistent for important ops
- **Test**: Verify toast timeout reasonable
- **UX Impact**: LOW - user can verify by refreshing

### ⚠️ 3.4 Wrong Error Message Shown
- **Scenario**: Server returns "Group 5 has 1 player", but UI shows "Group assignment failed"
- **Issue**: Generic error message, not the specific error from server
- **Solution**: Pass detailed error in toast description
- **Test**: Mock specific error, verify shown in toast
- **UX Impact**: MEDIUM - user confused

### ⚠️ 3.5 No Feedback for Slow Operations
- **Scenario**: Operation takes 15 seconds, spinner shows but no "Still processing..." message
- **Solution**: After 5 seconds, show secondary message
- **Test**: Mock 15s delay, verify secondary message appears
- **UX Impact**: MEDIUM - user thinks frozen

### ⚠️ 3.6 Reset Button Behavior Changes Based on hasScores
- **Scenario**: Reset visible but label/confirmation different if scores exist
- **Issue**: Confusing state transitions
- **Solution**: Clear visual/text distinction
- **Test**: Test reset with and without scores
- **UX Impact**: MEDIUM - user confusion

### ⚠️ 3.7 Can't Reconfigure After Error
- **Scenario**: Assignment fails, user wants to try different group count
- **Issue**: "Reconfigure" button disabled or unavailable
- **Solution**: Always show reconfigure option
- **Test**: Error state, reconfigure button available
- **UX Impact**: MEDIUM - stuck state

### ⚠️ 3.8 Multiple Admins Editing Causes Refresh Loops
- **Scenario**: Admin A creates stage, Admin B opens same tournament, sees old state
- **Cause**: No real-time refresh or optimistic updates
- **Solution**: Auto-refresh on certain operations, or subscription to changes
- **Test**: Multiple windows, verify state sync
- **UX Impact**: MEDIUM - stale data

### ⚠️ 3.9 Phase Indicators Unclear
- **Scenario**: UI shows "Configured", user doesn't know what button to click next
- **Issue**: Phase names internal, not user-friendly
- **Solution**: Clear status text "Ready to assign players" instead of "configured"
- **Test**: UI labels clear
- **UX Impact**: MEDIUM - discovery

### ⚠️ 3.10 Progress Not Visible
- **Scenario**: Assigning 1000 players to groups, no indication of progress
- **Solution**: Show "Processing player 234 of 1000..."
- **Test**: Large dataset, verify progress shown
- **UX Impact**: MEDIUM - perceived slowness

### ⚠️ 3.11 Configuration Locked Inappropriately
- **Scenario**: All competitors assigned, but admin made mistake in group count - can't reconfigure
- **Issue**: Lock logic too aggressive
- **Solution**: Allow reconfigure until fixtures generated
- **Test**: Verify lock timing correct
- **UX Impact**: MEDIUM - no recovery option

### ⚠️ 3.12 No Confirmation for Destructive Actions
- **Scenario**: User clicks "Close Stage & Advance to KO"
- **Issue**: Immediately advances, can create duplicate KO stages if clicked twice
- **Solution**: Confirmation dialog
- **Test**: Advance action, verify confirmation shown
- **UX Impact**: MEDIUM - accidental progression

---

## Test Strategy Improvements

### What Tests SHOULD Have Been Written:

1. **Hook Interaction Tests**
   - Verify `setLoading(true)` → async operation → `setLoading(false)`
   - In sequence, not just mocked away

2. **Loading State Lifecycle**
   - Initial state
   - During operation
   - After success
   - After error
   - After exception

3. **Timing Tests**
   - Slow operations (10+ seconds)
   - Rapid clicks/race conditions
   - Component unmount during async

4. **Error Path Tests**
   - Server error (returns `{ error: "..." }`)
   - Exception thrown
   - Timeout
   - Network failure

5. **UI State Tests**
   - Button disabled during operation
   - Button enabled after error
   - Toast appears and disappears
   - Loading text shown in button

6. **Data Interaction Tests**
   - Verify correct server action called
   - Verify correct parameters passed
   - Verify response handled correctly

7. **Concurrent Operation Tests**
   - Multiple clicks
   - Multiple admins
   - Conflicting operations

8. **Component Lifecycle Tests**
   - Unmount during operation
   - Remount after operation
   - Navigation during operation

---

## Commit: What Was Fixed

**Commit**: c04fb45  
**Message**: fix(MultiStageSetup): clear loading state in async handlers

Fixed missing `setLoading(false)` in finally blocks for:
- `handleAssignPlayers()`
- `handleGenerateFixtures()`
- `handleCreateStage()`
- `handleReconfigure()`
- `handleReset()`
- `handleCloseAndAdvance()`

This ensures loading indicator clears on both success and error paths.

---

## Next Steps

1. ✅ Run improved test suite to catch edge case failures
2. ⚠️ Add timeout protection for long-running operations
3. ⚠️ Add "Still processing..." message after 5 seconds
4. ⚠️ Add confirmation dialogs for destructive actions
5. ⚠️ Implement real-time data refresh for multi-admin scenarios
6. ⚠️ Add progress indicators for large operations
7. ⚠️ Lock/unlock UI appropriately based on stage state
8. ⚠️ Improve error messages with specific failures
