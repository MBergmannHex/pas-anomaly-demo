const { test, expect } = require('@playwright/test');
const path = require('path');

const CSV_FIXTURE = path.join(__dirname, 'fixtures', 'sample-alarms.csv');

// Helper: navigate to analysis mode and arrive at the empty state with upload button
async function goToAnalysis(page) {
    await page.goto('/');
    await page.locator('text=Alarm Event Analysis').click();
    await expect(page.locator('button:has-text("Select CSV File")')).toBeVisible({ timeout: 5000 });
}

test.describe('CSV upload flow (Analysis mode)', () => {
    test('Select CSV File button is present in analysis mode', async ({ page }) => {
        await goToAnalysis(page);
        await expect(page.locator('button:has-text("Select CSV File")')).toBeVisible();
    });

    test('uploading CSV advances to column mapping', async ({ page }) => {
        await goToAnalysis(page);

        const [fileChooser] = await Promise.all([
            page.waitForEvent('filechooser'),
            page.locator('button:has-text("Select CSV File")').click(),
        ]);
        await fileChooser.setFiles(CSV_FIXTURE);

        // Column mapping modal should appear
        await expect(page.locator('text=Configure Column Mappings')).toBeVisible({ timeout: 5000 });
    });

    test('confirming column mapping loads data table', async ({ page }) => {
        await goToAnalysis(page);

        const [fileChooser] = await Promise.all([
            page.waitForEvent('filechooser'),
            page.locator('button:has-text("Select CSV File")').click(),
        ]);
        await fileChooser.setFiles(CSV_FIXTURE);

        await expect(page.locator('text=Configure Column Mappings')).toBeVisible({ timeout: 5000 });
        await page.locator('button:has-text("Confirm & Process")').click();

        // Metric cards should appear after processing
        await expect(page.locator('text=Total Events')).toBeVisible({ timeout: 5000 });
    });

    test('metric cards display numeric counts after data load', async ({ page }) => {
        await goToAnalysis(page);

        const [fileChooser] = await Promise.all([
            page.waitForEvent('filechooser'),
            page.locator('button:has-text("Select CSV File")').click(),
        ]);
        await fileChooser.setFiles(CSV_FIXTURE);
        await page.locator('button:has-text("Confirm & Process")').click();

        await expect(page.locator('text=Total Events')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('text=Total Alarms')).toBeVisible();

        // At least one metric card should show a number
        const card = page.locator('.metric-card').first();
        await expect(card).toBeVisible();
        const text = await card.textContent();
        expect(text).toMatch(/\d/);
    });
});
