import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['**/*.test.{js,ts}'],
        exclude: ['node_modules', '.next'],
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
