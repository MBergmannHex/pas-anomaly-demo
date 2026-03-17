const { test, expect } = require('@playwright/test');

// Visual regression tests — compare screenshots against stored baselines.
// Run `npx playwright test --update-snapshots` to create/update baselines.

test.describe('Visual regression', () => {
    test('landing page matches baseline', async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');
        await expect(page).toHaveScreenshot('landing.png', { maxDiffPixelRatio: 0.02 });
    });

    test('D&R wizard Step 1 matches baseline', async ({ page }) => {
        await page.goto('/');
        await page.locator('text=AI Rationalization (D&R)').click();
        await expect(page.locator('text=Step 1: Data Upload')).toBeVisible({ timeout: 5000 });
        await page.waitForLoadState('networkidle');
        await expect(page).toHaveScreenshot('dr-wizard-step1.png', { maxDiffPixelRatio: 0.02 });
    });

    test('settings modal matches baseline', async ({ page }) => {
        await page.goto('/');
        await page.locator('button[title="Settings"]').click();
        await expect(page.locator('text=General Chat Model')).toBeVisible({ timeout: 3000 });
        await expect(page).toHaveScreenshot('settings-modal.png', { maxDiffPixelRatio: 0.02 });
    });

    test('light mode landing page matches baseline', async ({ page }) => {
        await page.goto('/');
        // App defaults to dark mode — switch to light for this baseline
        await page.locator('button[title*="Switch to Light Mode"]').first().click();
        await page.waitForLoadState('networkidle');
        await expect(page).toHaveScreenshot('landing-light.png', { maxDiffPixelRatio: 0.02 });
    });
});
