import 'dotenv/config';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

/**
 * Runs the FR-4.7 checks against MongoDB Atlas only.
 * The isolated database name is chosen here and dropped by the test.
 * This process never prints the connection string.
 */
function atlasHostname(uri) {
    if (!uri) {
        throw new Error('MONGODB_URI is not set. This test uses the project Atlas cluster only and will not fall back to a local database.');
    }
    if (/localhost|127\.0\.0\.1|\[::1\]/i.test(uri)) {
        throw new Error('Refusing to run: MONGODB_URI points at a local database.');
    }
    const readable = uri.replace(/\/\/[^/@]+@/, '//').replace(/^mongodb\+srv:\/\//, 'https://').replace(/^mongodb:\/\//, 'https://');
    let hostname = '';
    try { hostname = new URL(readable).hostname; } catch { throw new Error('MONGODB_URI could not be parsed.'); }
    if (!hostname.endsWith('.mongodb.net')) throw new Error('Refusing to run: MONGODB_URI is not a MongoDB Atlas host.');
    return hostname;
}

try {
    atlasHostname(process.env.MONGODB_URI);
} catch (error) {
    console.error(`BidPrep Atlas test failed: ${error.message}`);
    process.exit(1);
}

const database = `mtn_bidprep_test_${Date.now()}_${randomBytes(4).toString('hex')}`;
const child = spawn(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tests/atlas/bid-prep-atlas.test.js'], {
    env: {
        ...process.env,
        BID_PREP_ATLAS: '1',
        MONGODB_DB_NAME: database,
        JWT_SECRET: process.env.JWT_SECRET || randomBytes(32).toString('hex'),
        NODE_ENV: 'development',
        BID_PREP_DRAFTS_PER_HOUR: '10',
        BID_PREP_EXPORTS_PER_HOUR: '10',
        BID_PREP_DELETES_PER_HOUR: '10',
        BID_PREP_READS_PER_MINUTE: '60',
        BID_PREP_WRITES_PER_MINUTE: '60',
    },
    stdio: 'inherit',
});
child.on('exit', code => { process.exit(code ?? 1); });
