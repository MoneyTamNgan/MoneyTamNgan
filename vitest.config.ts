import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    test: {
        environment: 'node',
        include: [
            // Canonical test locations under tests/
            'tests/security/**/*.test.{js,ts}',
            'tests/integration/**/*.test.{js,ts}',
            'tests/contract/**/*.test.{js,ts}',
            // Vitest-based unit tests (use vitest/vi mocking, @/ alias imports)
            'tests/unit/analytics.test.js',
            'tests/unit/analytics-export-route.test.js',
            'tests/unit/ingestion-trigger-route.test.js',
            'tests/unit/scraping-trigger-route.test.js',
            'tests/unit/classification-override-route.test.js',
            'tests/unit/matchingEngine.test.js',
            'tests/unit/project-mapper.test.ts',
            'tests/unit/query-params.test.js',
            'tests/unit/tor-response.test.js',
        ],
        // Exclude node_modules, build output, old ad-hoc test locations (now canonical
        // copies live under tests/), and node:test–based pipeline tests in tests/unit/.
        exclude: [
            'node_modules',
            '.next',
            // Old locations — tests are now under tests/
            'test/**',
            'lib/**/*.test.{js,ts}',
            'app/**/*.test.{js,ts}',
            'proxy.test.js',
            // Pipeline / scraper tests that use node:test, run via `npm test`
            'tests/unit/discovery-candidates.test.js',
            'tests/unit/egp-rss.test.js',
            'tests/unit/fiscal-budget.test.js',
            'tests/unit/mongo-artifacts.test.js',
            'tests/unit/normalized-schema.test.js',
            'tests/unit/ocr-pipeline.test.js',
            'tests/unit/ocr-quality.test.js',
            'tests/unit/pipeline.test.js',
            'tests/unit/procurement-eligibility.test.js',
            'tests/unit/tender-acquisition.test.js',
            'tests/unit/text-extraction.test.js',
            'tests/unit/vertex-reanalysis.test.js',
            'tests/unit/vertex-resume.test.js',
            'tests/unit/classification.test.js',
        ],
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
