const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['server/__tests__/**/*.test.js'],
        testTimeout: 10000
    }
});
