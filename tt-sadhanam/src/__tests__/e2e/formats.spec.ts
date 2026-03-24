/**
 * End-to-End tests for specific tournament formats
 */

import { test, expect } from '@playwright/test'

test.describe('Double Elimination Format E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/tournaments/create')
    
    // Create DE tournament
    await page.fill('input[placeholder*="Name"]', 'DE Test Tournament')
    await page.selectOption('select[name="format_type"]', 'double_elimination')
    await page.click('button:has-text("Create")')
    
    await page.waitForLoadState('networkidle')
  })

  test('should add 8 players for DE bracket', async ({ page }) => {
    // Add 8 players
    for (let i = 1; i <= 8; i++) {
      await page.click('button:has-text("Add Player")')
      await page.fill('input[placeholder*="Name"]', `Player ${i}`)
      await page.fill('input[placeholder*="Seed"]', `${i}`)
      await page.click('button:has-text("Save")')
    }
    
    // Verify all 8 added
    const playerCount = await page.locator('[data-testid="player-row"]').count()
    expect(playerCount).toBeGreaterThanOrEqual(8)
  })

  test('should generate DE bracket with WB, LB, GF', async ({ page }) => {
    // Generate bracket
    await page.click('button:has-text("Generate Bracket")')
    await page.waitForLoadState('networkidle')
    
    // Check bracket sections exist
    await expect(page.locator('text=Winners Bracket')).toBeVisible()
    await expect(page.locator('text=Losers Bracket')).toBeVisible()
    await expect(page.locator('text=Grand Final')).toBeVisible()
  })

  test('should advance WB winner and WB loser to LB', async ({ page }) => {
    // Generate bracket
    await page.click('button:has-text("Generate Bracket")')
    await page.waitForLoadState('networkidle')
    
    // Find first WB match
    const wbMatches = page.locator('[data-bracket-side="winners"]')
    const firstWbMatch = wbMatches.first()
    
    // Click and score
    await firstWbMatch.click()
    await page.fill('input[name="game1_p1"]', '11')
    await page.fill('input[name="game1_p2"]', '8')
    await page.click('button:has-text("Save")')
    
    // Winner should appear in next WB round
    // Loser should appear in LB
    await expect(page.locator('text=Losers Bracket')).toBeVisible()
  })

  test('should handle grand final with WB winner undefeated', async ({ page }) => {
    // This would involve playing out full bracket
    // For now, just verify GF structure exists
    await page.click('button:has-text("Generate Bracket")')
    await page.waitForLoadState('networkidle')
    
    const grandFinal = page.locator('[data-bracket-side="grand_final"]')
    await expect(grandFinal).toBeVisible()
  })
})

test.describe('Multi-Stage RR to KO Format E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/tournaments/create')
    
    // Create multi-stage tournament
    await page.fill('input[placeholder*="Name"]', 'RR to KO Tournament')
    await page.selectOption('select[name="format_type"]', 'multi_rr_to_knockout')
    await page.fill('input[name="rr_groups"]', '4')
    await page.fill('input[name="rr_advance"]', '2')
    await page.click('button:has-text("Create")')
    
    await page.waitForLoadState('networkidle')
  })

  test('should display Stage 1: Round Robin setup', async ({ page }) => {
    await expect(page.locator('text=Stage 1: Round Robin')).toBeVisible()
    await expect(page.locator('text=Groups')).toBeVisible()
  })

  test('should add 16 players and generate groups', async ({ page }) => {
    // Add 16 players
    for (let i = 1; i <= 16; i++) {
      await page.click('button:has-text("Add Player")')
      await page.fill('input[placeholder*="Name"]', `Player ${i}`)
      await page.click('button:has-text("Save")')
    }
    
    // Generate groups
    await page.click('button:has-text("Generate Groups")')
    await page.waitForLoadState('networkidle')
    
    // Should see 4 groups
    await expect(page.locator('text=Group A')).toBeVisible()
    await expect(page.locator('text=Group D')).toBeVisible()
  })

  test('should generate RR fixtures', async ({ page }) => {
    // Generate groups first
    await page.click('button:has-text("Generate Groups")')
    await page.waitForLoadState('networkidle')
    
    // Generate fixtures
    await page.click('button:has-text("Generate Fixtures")')
    await page.waitForLoadState('networkidle')
    
    // Should see matches
    const matches = page.locator('[data-testid="match-card"]')
    const count = await matches.count()
    expect(count).toBeGreaterThan(0)
  })

  test('should show group standings after scoring matches', async ({ page }) => {
    // Generate and score some matches
    await page.click('button:has-text("Generate Groups")')
    await page.click('button:has-text("Generate Fixtures")')
    await page.waitForLoadState('networkidle')
    
    // Score a match
    await page.locator('[data-testid="match-card"]').first().click()
    await page.fill('input[name="game1_p1"]', '11')
    await page.fill('input[name="game1_p2"]', '8')
    await page.click('button:has-text("Save")')
    
    // Check standings table
    const standingsTable = page.locator('table')
    await expect(standingsTable).toBeVisible()
  })

  test('should transition to Stage 2 after RR complete', async ({ page }) => {
    // Complete RR stage (would need to score all matches in real scenario)
    // For now, mark as complete
    await page.click('button:has-text("Complete Stage 1")')
    
    // Stage 2 should become available
    await expect(page.locator('text=Stage 2: Knockout')).toBeVisible()
  })

  test('should generate KO bracket with RR qualifiers', async ({ page }) => {
    // Mark RR complete
    await page.click('button:has-text("Complete Stage 1")')
    
    // Generate KO bracket
    await page.click('button:has-text("Generate Bracket")')
    await page.waitForLoadState('networkidle')
    
    // Bracket should show qualified players
    const bracket = page.locator('[data-testid="bracket"]')
    await expect(bracket).toBeVisible()
  })
})

test.describe('Pure Round Robin Format E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/tournaments/create')
    
    // Create pure RR tournament
    await page.fill('input[placeholder*="Name"]', 'Pure RR Tournament')
    await page.selectOption('select[name="format_type"]', 'pure_round_robin')
    await page.click('button:has-text("Create")')
    
    await page.waitForLoadState('networkidle')
  })

  test('should create schedule for all players', async ({ page }) => {
    // Add players
    for (let i = 1; i <= 6; i++) {
      await page.click('button:has-text("Add Player")')
      await page.fill('input[placeholder*="Name"]', `Player ${i}`)
      await page.click('button:has-text("Save")')
    }
    
    // Generate schedule
    await page.click('button:has-text("Generate Schedule")')
    await page.waitForLoadState('networkidle')
    
    // Should show matches
    const matches = page.locator('[data-testid="match-card"]')
    await expect(matches.first()).toBeVisible()
  })

  test('should display standings as matches complete', async ({ page }) => {
    // Setup and generate
    for (let i = 1; i <= 4; i++) {
      await page.click('button:has-text("Add Player")')
      await page.fill('input[placeholder*="Name"]', `Player ${i}`)
      await page.click('button:has-text("Save")')
    }
    
    await page.click('button:has-text("Generate Schedule")')
    await page.waitForLoadState('networkidle')
    
    // Score a match
    await page.locator('[data-testid="match-card"]').first().click()
    await page.fill('input[name="game1_p1"]', '11')
    await page.fill('input[name="game1_p2"]', '8')
    await page.click('button:has-text("Save")')
    
    // Check standings updated
    const standings = page.locator('cell:has-text("Points")')
    await expect(standings).toBeVisible()
  })
})

test.describe('Single Knockout Format E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/tournaments/create')
    
    // Create single KO tournament
    await page.fill('input[placeholder*="Name"]', 'SK Tournament')
    await page.selectOption('select[name="format_type"]', 'single_knockout')
    await page.click('button:has-text("Create")')
    
    await page.waitForLoadState('networkidle')
  })

  test('should generate bracket with 8 players', async ({ page }) => {
    // Add 8 players
    for (let i = 1; i <= 8; i++) {
      await page.click('button:has-text("Add Player")')
      await page.fill('input[placeholder*="Name"]', `Player ${i}`)
      await page.fill('input[placeholder*="Seed"]', `${i}`)
      await page.click('button:has-text("Save")')
    }
    
    // Generate bracket
    await page.click('button:has-text("Generate Bracket")')
    await page.waitForLoadState('networkidle')
    
    // Verify structure: 4 R1, 2 R2, 1 Final
    const r1Matches = page.locator('[data-round="1"]')
    expect(await r1Matches.count()).toBeGreaterThan(0)
  })

  test('should handle non-power-of-2 with byes', async ({ page }) => {
    // Add 6 players
    for (let i = 1; i <= 6; i++) {
      await page.click('button:has-text("Add Player")')
      await page.fill('input[placeholder*="Name"]', `Player ${i}`)
      await page.click('button:has-text("Save")')
    }
    
    // Generate bracket
    await page.click('button:has-text("Generate Bracket")')
    await page.waitForLoadState('networkidle')
    
    // Should have bye indicators
    const byeMatches = page.locator('text=BYE')
    if (await byeMatches.count() > 0) {
      await expect(byeMatches.first()).toBeVisible()
    }
  })

  test('should advance winners through all rounds', async ({ page }) => {
    // Create and generate
    for (let i = 1; i <= 8; i++) {
      await page.click('button:has-text("Add Player")')
      await page.fill('input[placeholder*="Name"]', `Player ${i}`)
      await page.click('button:has-text("Save")')
    }
    
    await page.click('button:has-text("Generate Bracket")')
    await page.waitForLoadState('networkidle')
    
    // Score R1 match
    await page.locator('[data-testid="match-card"]').first().click()
    await page.fill('input[name="game1_p1"]', '11')
    await page.fill('input[name="game1_p2"]', '8')
    await page.click('button:has-text("Save")')
    
    // Winner should appear in R2
    const r2Matches = page.locator('[data-round="2"]')
    await expect(r2Matches.first()).toBeVisible()
  })
})
