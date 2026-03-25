# Test Coverage Analysis: Why the Bug Wasn't Caught

**Date**: 25 March 2026  
**Issue**: Hanging loader in MultiStageSetup - `setLoading(true)` without `setLoading(false)`  
**Root Cause**: Test strategy focused on happy path, mocked async operations away, never verified cleanup code paths

---

## The Gap

### What Original Tests Did ✅
- Unit tests for algorithm correctness (group distribution math)
- Component rendering with correct props
- Server action return values (success/error objects)
- Happy path + immediate error scenarios
- Basic E2E workflows

### What Original Tests Missed ❌
- **Hook integration** - Never verified `setLoading()` hook actually executes
- **State lifecycle** - Didn't test sequence: loading true → async → loading false
- **Error paths** - Tested error toast appears, but NOT loading state cleared
- **Real async timing** - Mocked everything to return instantly
- **Exception handling** - Never tested what happens if server action throws
- **Component cleanup** - Never tested unmount during operation
- **Race conditions** - Never tested multiple rapid clicks
- **GlobalLoader context** - Mocked away, never tested real integration

---

## The Bug

```tsx
// ❌ BEFORE (the bug)
const handleAssignPlayers = () => {
  if (!stage) return
  setLoading(true)  // ← Loading starts here
  startTransition(async () => {
    const result = await generateGroups(stage.id, tournament.id)
    if (result.error) {
      toast({ title: 'Group assignment failed', ... })
    } else {
      toast({ title: 'Players assigned to groups' })
    }
    // ← Missing: setLoading(false)
  })
}

// ✅ AFTER (fixed)
const handleAssignPlayers = () => {
  if (!stage) return
  setLoading(true)
  startTransition(async () => {
    try {
      const result = await generateGroups(stage.id, tournament.id)
      if (result.error) {
        toast({ title: 'Group assignment failed', ... })
      } else {
        toast({ title: 'Players assigned to groups' })
      }
    } finally {
      setLoading(false)  // ← Now always clears, even on exception
    }
  })
}
```

**Impact**: User sees spinning loader indefinitely with no toast, no feedback that operation completed.

---

## Why Tests Failed to Catch This

### Problem 1: Mocked Hook Behavior
Original tests mocked:
```tsx
const { setLoading } = useLoading()  // ← Mocked function
```

The mock never actually tracks call sequence. Tests verified `setLoading` was called, but not:
- Was it called with false?
- When was it called?
- Was it called in finally block or only in try?

### Problem 2: Instant Mocked Operations
```tsx
jest.mock('@/lib/actions/roundRobin', () => ({
  generateGroups: jest.fn().mockResolvedValue({})  // ← Returns instantly
}))
```

Real async operations reveal missing cleanup. Mocked-to-instant operations hide it.

### Problem 3: No Lifecycle Tests
Original tests didn't have assertions like:
```tsx
// What SHOULD have been tested:
expect(setLoading).toHaveBeenCalledWith(true)  // At start ✓
await waitFor(() => {
  expect(setLoading).toHaveBeenCalledWith(false)  // At end ✗ MISSED
})
```

### Problem 4: Happy Path Bias
Tests focused on:
- User can click button ✓
- Success toast appears ✓
- Error toast appears ✓

But never traced the full execution path with respect to GlobalLoader state.

### Problem 5: No Integration with GlobalLoader
Tests never checked:
- GlobalLoader component actually responds to loading state
- Spinner HTML actually appears/disappears
- User sees visual feedback

---

## All Edge Cases & Failure Modes (42 total)

### 1. STATE MANAGEMENT (18 scenarios)
1. ✅ **Hanging loaders** - FIXED in c04fb45
2. ⚠️ Server action timeout (>30s)
3. ⚠️ Network error mid-operation
4. ⚠️ Race condition (multiple clicks)
5. ⚠️ Unhandled exception in action
6. ⚠️ Partial transaction success
7. ⚠️ Button state desync
8. ⚠️ Component unmount during async
9. ⚠️ Modal closes but operation continues
10. ⚠️ Error state doesn't reset
11. ⚠️ Multiple admins concurrent ops
12. ⚠️ Slow network, no feedback
13. ⚠️ Rapid reconfigure/reset attempts
14. ⚠️ Callback closure bug (stale refs)
15. ⚠️ Memory leak (async after unmount)
16. ⚠️ Browser back button during op
17. ⚠️ Tab hidden, operation continues
18. ⚠️ Toast auto-dismiss too soon

### 2. DATA CONSISTENCY (12 scenarios)
19. ⚠️ Players assigned but groups don't exist
20. ⚠️ Groups exist but no fixtures
21. ⚠️ Fixtures missing some players
22. ⚠️ Reset doesn't actually clear
23. ⚠️ Orphaned database rows
24. ⚠️ Foreign key violation
25. ⚠️ Duplicate player in group
26. ⚠️ Partial database commit
27. ⚠️ Config changed during assignment
28. ⚠️ New players added after stage
29. ⚠️ Group count mismatches
30. ⚠️ Player count exceeds capacity

### 3. UI/UX ISSUES (12 scenarios)
31. ✅ **Spinning loader persists** - FIXED
32. ⚠️ Button stays disabled after error
33. ⚠️ Toast disappears too quickly
34. ⚠️ Wrong error message shown
35. ⚠️ No feedback for slow ops
36. ⚠️ Reset behavior inconsistent
37. ⚠️ Can't reconfigure after error
38. ⚠️ Multiple admin refresh loops
39. ⚠️ Phase indicators unclear
40. ⚠️ Progress not visible (1000 players)
41. ⚠️ Configuration locked inappropriately
42. ⚠️ No confirmation for destructive actions

---

## Test Strategy That Would Have Caught This

### 1. Loading State Lifecycle Tests
```typescript
it('should clear loading after successful assignment', async () => {
  // Mock server action
  generateGroups.mockResolvedValue({})
  
  // Render component
  render(<MultiStageSetup ... />)
  
  // Verify initial state
  expect(setLoading).not.toHaveBeenCalled()
  
  // Click button
  userEvent.click(screen.getByText(/Assign/i))
  expect(setLoading).toHaveBeenCalledWith(true)  // ← Starts
  
  // Wait for completion
  await waitFor(() => {
    expect(setLoading).toHaveBeenCalledWith(false)  // ← Ends
  })
})
```

### 2. Error Path Cleanup Tests
```typescript
it('should clear loading even on error', async () => {
  generateGroups.mockResolvedValue({
    error: 'Database error'
  })
  
  userEvent.click(screen.getByText(/Assign/i))
  
  // BOTH must happen in error case:
  await waitFor(() => {
    expect(setLoading).toHaveBeenCalledWith(false)  // ← THIS WAS MISSING
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' })
    )
  })
})
```

### 3. Exception Handling Tests
```typescript
it('should clear loading on unhandled exception', async () => {
  generateGroups.mockRejectedValue(new Error('Network'))
  
  userEvent.click(...)
  
  // setLoading(false) must execute even if exception thrown
  await waitFor(() => {
    expect(setLoading).toHaveBeenCalledWith(false)
  })
})
```

### 4. Timing Tests
```typescript
it('should not hang on 10s operation', async () => {
  generateGroups.mockImplementation(
    () => new Promise(resolve => 
      setTimeout(() => resolve({}), 10000)
    )
  )
  
  userEvent.click(...)
  
  // Even slow operations must clear loading
  await waitFor(() => {
    expect(setLoading).toHaveBeenCalledWith(false)
  }, { timeout: 12000 })
})
```

### 5. Race Condition Tests
```typescript
it('should handle rapid multi-clicks', async () => {
  userEvent.click(button)
  userEvent.click(button)
  userEvent.click(button)
  
  // All clicks eventually clear loading
  await waitFor(() => {
    const clearCalls = setLoading.mock.calls.filter(c => c[0] === false)
    expect(clearCalls.length).toBeGreaterThan(0)
  })
})
```

### 6. Component Lifecycle Tests
```typescript
it('should not update after unmount', () => {
  generateGroups.mockImplementation(
    () => new Promise(r => setTimeout(r, 200))
  )
  
  const { unmount } = render(<MultiStageSetup ... />)
  userEvent.click(...)
  unmount()  // Unmount before async completes
  
  // No React warnings about setState on unmounted component
})
```

### 7. Integration Tests
```typescript
it('loading indicator actually shows/hides', async () => {
  generateGroups.mockResolvedValue({})
  
  using GlobalLoader real context, not mocked
  
  userEvent.click(button)
  expect(screen.getByRole('status')).toHaveClass('visible')
  
  await waitFor(() => {
    expect(screen.getByRole('status')).not.toHaveClass('visible')
  })
})
```

---

## Test Quality Improvements

### What Should Be Official Policy:

**1. No Mocking Async Cleanup**
- Always test cleanup code paths
- Use `finally` blocks, verify they execute
- Test both success AND error paths

**2. Lifecycle Assertions**
- Initialize, Start, In-progress, Complete, Error → each state tested
- Verify state transitions occur correctly

**3. Real-time Hook Testing**
- Don't mock hooks that manage critical state
- Use real hooks with mock data injected

**4. Edge Cases Mandatory**
- Errors (connection, validation, exception)
- Timing (slow, fast, immediate)
- Concurrency (multiple operations, rapid clicks)

**5. Integration > Unit**
- Test hooks talking to components
- Test components talking to services
- Test context updates reflecting in UI

**6. UI State = Test**
- If user can see it, test it
- Loading indicators, disabled buttons, toasts
- Test feedback to user, not just data flow

---

## Lessons Learned

1. **Don't mock what you're testing** - We mocked loading state, so we couldn't test it
2. **Test cleanup paths explicitly** - try/catch/finally patterns must be verified
3. **Real timing matters** - Instant mocks hide async bugs
4. **Happy path is insufficient** - Error paths need same rigor
5. **Integration testing is underrated** - Hook + component + context = real issues
6. **UI feedback is testable** - Verify users see what they should see

---

## What's Fixed

✅ **Commit c04fb45**: Loading state now clears in all 6 async handlers:
- handleAssignPlayers()
- handleGenerateFixtures()  
- handleCreateStage()
- handleReconfigure()
- handleReset()
- handleCloseAndAdvance()

Each now wraps async operation in try/finally, ensuring `setLoading(false)` executes.

---

## Remaining Edge Cases to Address

**High Priority** (blocks tournament operation):
1. ⚠️ Slow network timeout protection (operations hang >30s)
2. ⚠️ Concurrent operation prevention (admin A + B conflict)
3. ⚠️ Exception handling (server action throws)

**Medium Priority** (poor UX):
4. ⚠️ "Still processing..." message after 5s
5. ⚠️ Confirmation dialogs for destructive actions
6. ⚠️ Better error messages (specific vs generic)
7. ⚠️ Button recovery on error

**Low Priority** (nice to have):
8. ⚠️ Progress indicators for large operations
9. ⚠️ Real-time data refresh
10. ⚠️ Toast timeout tuning
