import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    test: {
        environment: 'node',
        include: ['**/*.test.{js,ts}'],
        // The backend/scraper pipeline (test/**, lib/classification.test.js) uses
        // node:test, run separately via `npm test`. Keep this config scoped to the
        // Next.js app's own Vitest suite so it doesn't try to run those as Vitest.
        exclude: ['node_modules', '.next', 'test/**', 'lib/classification.test.js'],
        env: {
            // Dummy values so importing route modules never throws on a missing
            // env var — nothing in the test suite opens a real network connection.
            MONGODB_URI: 'mongodb://localhost:27017/ci',
            JWT_SECRET: 'ci-placeholder-secret',
            NEXT_PUBLIC_REDIRECT_URI: 'http://localhost:3000/api/auth/google/callback',
        },
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, '.'),
        },
    },
});
