const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './e2e',
    fullyParallel: false,
    retries: 0,
    reporter: [['list'], ['html', { open: 'never' }]],

    use: {
        baseURL: 'http://localhost:8080',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
    },

    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],

    // Start the app server before tests, shut it down after
    webServer: {
        command: 'node server/server.js',
        url: 'http://localhost:8080/api/health',
        reuseExistingServer: !process.env.CI,
        timeout: 15000,
        env: {
            PORT: '8080',
            NODE_ENV: 'test',
            // Dummy values so config.js doesn't fail on missing vars
            AZURE_OPENAI_API_KEY: 'test-key',
            AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
        },
    },
});
