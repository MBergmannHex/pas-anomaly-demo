const { test, expect } = require('@playwright/test');

test.describe('App loads', () => {
    test('landing page renders with both workflow cards', async ({ page }) => {
        await page.goto('/');
        // App title in header (use first() — also appears in welcome h2)
        await expect(page.locator('h1').first()).toBeVisible();
        // Both workflow cards
        await expect(page.locator('text=Alarm Event Analysis')).toBeVisible();
        await expect(page.locator('text=AI Rationalization (D&R)')).toBeVisible();
    });

    test('health endpoint returns ok', async ({ request }) => {
        const res = await request.get('/api/health');
        expect(res.ok()).toBe(true);
        const body = await res.json();
        expect(body.status).toBe('ok');
        expect(body.version).toBe('5.0.0');
    });

    test('models endpoint returns chat models', async ({ request }) => {
        const res = await request.get('/api/models');
        expect(res.ok()).toBe(true);
        const body = await res.json();
        expect(Array.isArray(body.chatModels)).toBe(true);
        expect(body.chatModels.length).toBeGreaterThan(0);
    });

    test('dark mode toggle switches theme', async ({ page }) => {
        await page.goto('/');
        // App defaults to dark mode — button title says "Switch to Light Mode"
        const toLightBtn = page.locator('button[title*="Switch to Light Mode"]').first();
        await expect(toLightBtn).toBeVisible({ timeout: 5000 });
        await toLightBtn.click();
        // Now in light mode — button should say "Switch to Dark Mode"
        await expect(page.locator('button[title*="Switch to Dark Mode"]').first()).toBeVisible();
        // Toggle back to dark
        await page.locator('button[title*="Switch to Dark Mode"]').first().click();
        await expect(page.locator('button[title*="Switch to Light Mode"]').first()).toBeVisible();
    });
});
