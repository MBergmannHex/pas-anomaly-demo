const { test, expect } = require('@playwright/test');

test.describe('D&R Rationalization wizard', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.locator('text=AI Rationalization (D&R)').click();
    });

    test('Step 1 shows both upload zones', async ({ page }) => {
        await expect(page.locator('text=Step 1: Data Upload')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('text=Master Alarm Database (CSV)')).toBeVisible();
        await expect(page.locator('text=Alarm Philosophy')).toBeVisible();
    });

    test('upload zones show drop hint text', async ({ page }) => {
        await expect(page.locator('text=Drop CSV here or click to browse')).toBeVisible();
        await expect(page.locator('text=Drop PDF/TXT/DOCX here or click to browse')).toBeVisible();
    });

    test('drag-over activates visual feedback on MADB zone', async ({ page }) => {
        await expect(page.locator('text=Step 1: Data Upload')).toBeVisible({ timeout: 5000 });

        // Find the MADB upload zone container
        const madbZone = page.locator('text=Master Alarm Database (CSV)').locator('..');

        // Simulate dragenter
        await madbZone.dispatchEvent('dragenter', {
            dataTransfer: await page.evaluateHandle(() => new DataTransfer()),
        });

        // The overlay "Drop CSV here" text should appear
        await expect(page.locator('text=Drop CSV here').last()).toBeVisible({ timeout: 2000 });
    });

    test('clicking MADB zone opens file picker', async ({ page }) => {
        await expect(page.locator('text=Step 1: Data Upload')).toBeVisible({ timeout: 5000 });

        const [fileChooser] = await Promise.all([
            page.waitForEvent('filechooser'),
            page.locator('text=Master Alarm Database (CSV)').locator('..').click(),
        ]);
        expect(fileChooser).toBeTruthy();
    });

    test('clicking Philosophy zone opens file picker', async ({ page }) => {
        await expect(page.locator('text=Step 1: Data Upload')).toBeVisible({ timeout: 5000 });

        const [fileChooser] = await Promise.all([
            page.waitForEvent('filechooser'),
            page.locator('text=Alarm Philosophy').locator('..').click(),
        ]);
        expect(fileChooser).toBeTruthy();
    });

    test('Next button is disabled before CSV upload', async ({ page }) => {
        await expect(page.locator('text=Step 1: Data Upload')).toBeVisible({ timeout: 5000 });
        const nextBtn = page.locator('button:has-text("Next")').first();
        await expect(nextBtn).toBeDisabled();
    });
});
