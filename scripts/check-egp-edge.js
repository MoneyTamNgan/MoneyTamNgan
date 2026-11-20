#!/usr/bin/env node

/**
 * Fail when this machine is blocked by the e-GP Cloudflare page.
 *
 * No API key is sent. A missing-key JSON response means the edge let the
 * request through; ingestion then checks EGP_API_KEY. A connection error is
 * not fatal here, because the scheduler already retries those.
 */

import { probeEgpEdge } from '../lib/egp-api.js';

const result = await probeEgpEdge();
if (!result.ok) {
    console.error(result.message);
    process.exit(1);
}
if (result.skipped) {
    console.log(`e-GP edge probe did not connect (${result.reason}). Ingestion will apply its own retries.`);
} else {
    console.log(`e-GP edge accepted a request from this runner (HTTP ${result.status}).`);
}
