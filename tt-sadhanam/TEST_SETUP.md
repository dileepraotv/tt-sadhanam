# Testing Setup Guide

## Installation

Before running tests, ensure Node.js is installed on your machine. Then install dependencies:

```bash
npm install
```

## Test Scripts

### Unit & Component Tests (Jest)

```bash
# Run all unit and component tests
npm test

# Watch mode (re-run on file changes)
npm run test:watch

# Coverage report
npm run test:coverage

# Run unit tests only
npm run test:unit

# Run component tests only
npm run test:components

# Run integration tests only
npm run test:integration
```

### End-to-End Tests (Playwright)

```bash
# Run all E2E tests (headless)
npm run test:e2e

# Run with UI mode (interactive)
npm run test:e2e:ui

# Debug mode
npm run test:e2e:debug

# Run all tests (unit + E2E)
npm run test:all
```

## Test Structure

```
src/__tests__/
├── unit/              # Business logic, utilities, helpers
├── components/        # React component rendering & interactions
├── integration/       # Server actions, API calls, data flows
└── e2e/              # Full user workflows (Playwright)
```

## Configuration Files

- **jest.config.js** - Jest configuration with Next.js support
- **jest.setup.js** - Global test setup, mocks, and environment variables
- **playwright.config.ts** - Playwright configuration for E2E tests
- **.env.test** - Test environment variables

## Key Features

- ✅ Next.js 14 support with built-in Jest configuration
- ✅ React Testing Library for component testing
- ✅ 50% minimum coverage threshold
- ✅ Playwright for E2E testing across browsers (Chrome, Firefox, Safari)
- ✅ Mobile viewport testing (iOS & Android)
- ✅ Mocked Next.js navigation and image components
- ✅ HTML reporter for test results

## Running Tests in Your Workflow

1. **Before committing:** `npm run test:coverage`
2. **During development:** `npm run test:watch`
3. **Before deployment:** `npm run test:all`
4. **Debugging failures:** `npm run test:e2e:debug`

## Environment

Tests use mocked Supabase credentials. For integration tests requiring real database access, update `.env.test` with appropriate values.
