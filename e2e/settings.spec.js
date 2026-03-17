const { test, expect } = require('@playwright/test');

test.describe('Settings panel', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('settings button opens the modal', async ({ page }) => {
        await page.locator('button[title="Settings"]').click();
        await expect(page.locator('text=General Chat Model')).toBeVisible({ timeout: 3000 });
        await expect(page.locator('text=D&R Reasoning Model')).toBeVisible();
    });

    test('model dropdowns are populated', async ({ page }) => {
        await page.locator('button[title="Settings"]').click();
        await expect(page.locator('text=General Chat Model')).toBeVisible({ timeout: 3000 });

        // Both selects should have options loaded from /api/models
        const selects = page.locator('select');
        const count = await selects.count();
        expect(count).toBeGreaterThanOrEqual(2);

        const firstOptions = await selects.first().locator('option').count();
        expect(firstOptions).toBeGreaterThan(0);
    });

    test('Cancel button closes the modal', async ({ page }) => {
        await page.locator('button[title="Settings"]').click();
        await expect(page.locator('text=General Chat Model')).toBeVisible({ timeout: 3000 });
        await page.locator('button:has-text("Cancel")').click();
        await expect(page.locator('text=General Chat Model')).not.toBeVisible({ timeout: 2000 });
    });
});
