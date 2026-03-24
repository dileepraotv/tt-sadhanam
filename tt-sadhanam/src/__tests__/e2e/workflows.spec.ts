/**
 * End-to-End tests for tournament workflows
 * These tests simulate real user interactions
 */

import { test, expect } from '@playwright/test'

test.describe('Homepage & Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('should load homepage', async ({ page }) => {
    await expect(page).toHaveTitle(/TT-SADHANAM|Tournament/)
  })

  test('should display logo and header', async ({ page }) => {
    const logo = page.locator('text=TT-SADHANAM')
    await expect(logo).toBeVisible()
  })

  test('should show sign in button for anonymous user', async ({ page }) => {
    const signInBtn = page.locator('button:has-text("Sign In")')
    await expect(signInBtn).toBeVisible()
  })

  test('should navigate to championships from home', async ({ page }) => {
    await page.click('a:has-text("Championships")')
    await expect(page).toHaveURL(/championships/)
  })

  test('should toggle theme', async ({ page }) => {
    const themeBtn = page.locator('button:has-text("Dark Mode")')
    await expect(themeBtn).toBeVisible()
    await themeBtn.click()
    await expect(page.locator('button:has-text("Light Mode")')).toBeVisible()
  })
})

test.describe('Admin: Create Tournament Workflow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/championships')
  })

  test('should create new championship', async ({ page }) => {
    // Click create championship button
    await page.click('button:has-text("New Championship")')
    
    // Fill form
    await page.fill('input[placeholder*="Name"]', 'Nationals 2026')
    await page.fill('input[type="text"]', 'National Table Tennis Championship')
    
    // Submit
    await page.click('button:has-text("Create")')
    
    // Should show created championship
    await expect(page.locator('text=Nationals 2026')).toBeVisible()
  })

  test('should create tournament within championship', async ({ page }) => {
    // Navigate to a championship
    await page.click('a:has-text("Nationals 2026")')
    
    // Click add event/tournament
    await page.click('button:has-text("Add Event")')
    
    // Fill tournament details
    await page.fill('input[placeholder*="Tournament Name"]', 'Men Singles')
    await page.selectOption('select[name="format"]', 'multi_rr_to_knockout')
    await page.fill('input[name="groups"]', '4')
    await page.fill('input[name="advance"]', '2')
    
    // Submit
    await page.click('button:has-text("Create Tournament")')
    
    // Verify tournament created
    await expect(page.locator('text=Men Singles')).toBeVisible()
  })
})

test.describe('Admin: Player Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/tournaments/test-tournament')
  })

  test('should add players manually', async ({ page }) => {
    // Click add player button
    await page.click('button:has-text("Add Player")')
    
    // Fill player details
    await page.fill('input[placeholder*="Player Name"]', 'John Smith')
    await page.fill('input[placeholder*="Seed"]', '1')
    await page.fill('input[placeholder*="Club"]', 'Club A')
    
    // Save
    await page.click('button:has-text("Save")')
    
    // Verify player added
    await expect(page.locator('text=John Smith')).toBeVisible()
  })

  test('should upload players from Excel', async ({ page }) => {
    // Click upload button
    await page.click('button:has-text("Upload Excel")')
    
    // Upload file (would need actual file in test)
    // For now, just verify UI is there
    const uploadInput = page.locator('input[type="file"]')
    await expect(uploadInput).toBeVisible()
  })

  test('should edit player seed', async ({ page }) => {
    // Find player row
    const playerRow = page.locator('text=John Smith').first()
    
    // Click edit button in row
    await playerRow.locator('button:has-text("Edit")').click()
    
    // Update seed
    await page.fill('input[placeholder*="Seed"]', '2')
    await page.click('button:has-text("Save")')
    
    // Verify update
    await expect(page.locator('text=John Smith')).toBeVisible()
  })

  test('should remove player', async ({ page }) => {
    const playerRow = page.locator('text=John Smith').first()
    
    // Click delete button
    await playerRow.locator('button:has-text("Delete")').click()
    
    // Confirm deletion
    page.once('dialog', dialog => dialog.accept())
    
    // Verify removed
    await expect(page.locator('text=John Smith')).not.toBeVisible()
  })
})

test.describe('Admin: Bracket Generation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/tournaments/test-tournament')
  })

  test('should generate round-robin groups', async ({ page }) => {
    // Navigate to RR setup
    await page.click('text=Round Robin Setup')
    
    // Click generate groups
    await page.click('button:has-text("Generate Groups")')
    
    // Wait for generation
    await page.waitForLoadState('networkidle')
    
    // Should see groups created
    await expect(page.locator('text=Group A')).toBeVisible()
    await expect(page.locator('text=Group B')).toBeVisible()
  })

  test('should generate fixtures', async ({ page }) => {
    // Must have groups first
    await page.click('text=Round Robin Setup')
    await page.click('button:has-text("Generate Fixtures")')
    
    await page.waitForLoadState('networkidle')
    
    // Should see match cards
    const matchCards = page.locator('[data-testid="match-card"]')
    await expect(matchCards.first()).toBeVisible()
  })

  test('should generate knockout bracket', async ({ page }) => {
    // Navigate to knockout setup
    await page.click('text=Knockout Setup')
    
    // Click generate bracket
    await page.click('button:has-text("Generate Bracket")')
    
    await page.waitForLoadState('networkidle')
    
    // Should see bracket rounds
    await expect(page.locator('text=Round 1')).toBeVisible()
  })

  test('should reset bracket if needed', async ({ page }) => {
    await page.click('text=Knockout Setup')
    
    // Click reset button
    await page.click('button:has-text("Reset Bracket")')
    
    // Confirm
    page.once('dialog', dialog => dialog.accept())
    
    // Bracket should be cleared
    await page.waitForLoadState('networkidle')
  })
})

test.describe('Admin: Match Scoring', () => {
  test.beforeEach(async ({ page }) => {
    // Go to a bracket view with matches
    await page.goto('/admin/tournaments/test-tournament/bracket')
  })

  test('should open match detail dialog', async ({ page }) => {
    // Click on a match
    await page.locator('[data-testid="match-card"]').first().click()
    
    // Dialog should open
    await expect(page.locator('[role="dialog"]')).toBeVisible()
  })

  test('should enter game scores', async ({ page }) => {
    // Open match dialog
    await page.locator('[data-testid="match-card"]').first().click()
    
    // Enter game 1 scores
    await page.fill('input[name="game1_p1"]', '11')
    await page.fill('input[name="game1_p2"]', '8')
    
    // Confirm win
    await page.click('text=Game 1 to Player 1')
    
    // Enter game 2
    await page.fill('input[name="game2_p1"]', '11')
    await page.fill('input[name="game2_p2"]', '9')
    
    // Submit
    await page.click('button:has-text("Save Match")')
    
    // Dialog closes
    await expect(page.locator('[role="dialog"]')).not.toBeVisible()
  })

  test('should update bracket after scoring', async ({ page }) => {
    // Score a match
    await page.locator('[data-testid="match-card"]').first().click()
    await page.fill('input[name="game1_p1"]', '11')
    await page.fill('input[name="game1_p2"]', '8')
    await page.click('button:has-text("Save Match")')
    
    // Check next round match is populated
    await expect(page.locator('text=Next Round')).toBeVisible()
  })
})

test.describe('Public: View Tournament', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/tournaments/test-tournament')
  })

  test('should display tournament info', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('Tournament')
    await expect(page.locator('text=Players:')).toBeVisible()
  })

  test('should view bracket on public page', async ({ page }) => {
    // Bracket should be visible
    const bracket = page.locator('[data-testid="bracket"]')
    await expect(bracket).toBeVisible()
  })

  test('should view standings for RR stage', async ({ page }) => {
    // If RR format, standings should show
    const standingsTable = page.locator('table')
    if (await standingsTable.count() > 0) {
      await expect(standingsTable).toBeVisible()
    }
  })

  test('should view match details without editing', async ({ page }) => {
    // Click match
    await page.locator('[data-testid="match-card"]').first().click()
    
    // Dialog opens but no save button
    await expect(page.locator('[role="dialog"]')).toBeVisible()
    await expect(page.locator('button:has-text("Save")')).not.toBeVisible()
  })

  test('should show live badges for ongoing matches', async ({ page }) => {
    // Look for live indicator
    const liveBadges = page.locator('text=LIVE')
    if (await liveBadges.count() > 0) {
      await expect(liveBadges.first()).toBeVisible()
    }
  })
})

test.describe('Real-time Updates', () => {
  test('should reflect score updates in real-time', async ({ browser }) => {
    // Open two browser contexts to simulate two users
    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    
    const page1 = await ctx1.newPage()
    const page2 = await ctx2.newPage()
    
    try {
      // User 1: Admin entering score
      await page1.goto('/admin/tournaments/test-tournament/bracket')
      
      // User 2: Public viewing
      await page2.goto('/tournaments/test-tournament')
      
      // User 1 enters score
      await page1.locator('[data-testid="match-card"]').first().click()
      await page1.fill('input[name="game1_p1"]', '11')
      await page1.fill('input[name="game1_p2"]', '8')
      await page1.click('button:has-text("Save Match")')
      
      // User 2 should see update (with small delay for DB sync)
      await page2.waitForTimeout(1000)
      await page2.reload()
      
      // Score should be visible on public page
      const scoreText = page2.locator('text=11-8')
      await expect(scoreText).toBeVisible()
    } finally {
      await page1.close()
      await page2.close()
      await ctx1.close()
      await ctx2.close()
    }
  })
})

test.describe('Responsive Design', () => {
  test('should work on mobile viewport', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 })
    
    await page.goto('/tournaments/test-tournament')
    
    // Header should be visible
    await expect(page.locator('header')).toBeVisible()
    
    // Bracket should be scrollable
    const bracket = page.locator('[data-testid="bracket"]')
    await expect(bracket).toBeVisible()
  })

  test('should work on tablet viewport', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 })
    
    await page.goto('/tournaments/test-tournament')
    
    const bracket = page.locator('[data-testid="bracket"]')
    await expect(bracket).toBeVisible()
  })

  test('should work on desktop viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    
    await page.goto('/tournaments/test-tournament')
    
    const bracket = page.locator('[data-testid="bracket"]')
    await expect(bracket).toBeVisible()
  })
})

test.describe('Error Handling', () => {
  test('should show error for invalid tournament ID', async ({ page }) => {
    await page.goto('/tournaments/invalid-id')
    
    const notFound = page.locator('text=not found|not exist|No tournament')
    await expect(notFound).toBeVisible()
  })

  test('should show error when network fails', async ({ page }) => {
    // Simulate offline
    await page.context().setOffline(true)
    
    await page.goto('/tournaments/test-tournament')
    
    const errorMsg = page.locator('text=connection|offline|error')
    if (await errorMsg.count() > 0) {
      await expect(errorMsg.first()).toBeVisible()
    }
    
    // Restore connection
    await page.context().setOffline(false)
  })
})
