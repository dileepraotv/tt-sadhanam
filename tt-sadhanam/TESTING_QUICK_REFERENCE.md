# Quick Test Reference

## 🚀 Running Tests

### All Tests (Jest only)
```bash
npm test
```

### Specific Test Types
```bash
npm run test:unit           # Business logic tests
npm run test:components     # UI component tests
npm run test:integration    # Server action & data flow tests
```

### E2E Tests (Playwright)
```bash
# Start dev server first
npm run dev

# In another terminal, run E2E tests
npm run test:e2e            # Headless mode
npm run test:e2e:ui         # Interactive UI mode (recommended)
npm run test:e2e:debug      # Debug mode with Playwright Inspector
```

## 📊 Coverage Report
```bash
npm run test:coverage
# Open coverage/lcov-report/index.html to view detailed report
```

## 🔍 Watch Mode (for development)
```bash
npm run test:watch          # Re-run tests on file changes
```

## 📋 Test Files

### Unit Tests
- `src/__tests__/unit/roundRobin.test.ts` (16 tests)
- `src/__tests__/unit/doubleElimination.test.ts` (14 tests)
- `src/__tests__/unit/knockout.test.ts` (16 tests)
- `src/__tests__/unit/utils.test.ts` (12 tests)

### Component Tests
- `src/__tests__/components/shared.test.tsx` (13 tests)
- `src/__tests__/components/brackets.test.tsx` (20 tests)
- `src/__tests__/components/admin.test.tsx` (18 tests)

### Integration Tests
- `src/__tests__/integration/actions.test.ts` (25 tests)
- `src/__tests__/integration/dataFlow.test.ts` (20 tests)

### E2E Tests
- `src/__tests__/e2e/workflows.spec.ts` (50+ scenarios)
- `src/__tests__/e2e/formats.spec.ts` (10+ scenarios)

## 📈 Current Status
- ✅ 154 Jest tests passing
- ✅ 9 test suites passing
- ✅ 60+ E2E scenarios ready
- ✅ All formats tested

## 🎯 Test Coverage
- Round Robin formats
- Double Elimination
- Knockout brackets
- Multi-stage tournaments
- Admin workflows
- Public viewing
- Real-time updates
- Responsive design

## 💡 Tips
- Use `--watch` flag for active development
- Run E2E tests before major deployments
- Check coverage report regularly
- Keep tests close to your code changes
