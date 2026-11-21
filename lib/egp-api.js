/**
 * EGP-CONTRACT API Service
 *
 * Fetches government procurement project data from the Open Government Data
 * of Thailand (opend.data.go.th) EGP-CONTRACT endpoint and transforms the
 * response to match the Project schema.
 */

import { createHash } from 'node:crypto';

const EGP_BASE_URL = 'https://opend.data.go.th/govspending/service/egp-contract';
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 1000;
const ERROR_BODY_LIMIT = 16384;
const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

function redactSecret(text, apiKey) {
    if (!apiKey) return text;
    return String(text).replaceAll(apiKey, '[REDACTED]').replaceAll(encodeURIComponent(apiKey), '[REDACTED]');
}

/**
 * Tell an edge block apart from an API-key rejection.
 *
 * opend.data.go.th sits behind Cloudflare. A 403 HTML page titled "Access Denied"
 * that says the request was "blocked by our security systems" (and quotes a Ray ID
 * and the client IP) is that edge rule. The origin never sees the API key.
 * A JSON 401/403 that names the key is the origin rejecting the credential.
 *
 * @param {{ status: number, statusText?: string, body?: string, apiKey?: string }} input
 * @returns {{ code: string, retryable?: boolean, message: string, rayId?: string }}
 */
export function describeEgpHttpFailure({ status, statusText = '', body = '', apiKey = '' }) {
    const redacted = redactSecret(String(body || '').slice(0, ERROR_BODY_LIMIT), apiKey);
    // The live page is `<strong>Ray ID:</strong> <hex>`, so match the label on
    // tag-stripped text. The title check stays on the raw HTML.
    const plain = redacted.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const rayId = plain.match(/Ray ID:\s*([0-9a-f]{6,})/i)?.[1] || '';
    const clientIp = plain.match(/IP Address:\s*((?:\d{1,3}\.){3}\d{1,3}|[0-9a-f:]+)/i)?.[1] || '';
    const securityBlock = status === 403
        && /<title>\s*Access Denied\s*<\/title>/i.test(redacted)
        && (/blocked by our security systems/i.test(redacted) || Boolean(rayId));
    if (securityBlock) {
        const where = [
            rayId ? `Ray ID ${rayId}` : '',
            clientIp ? `client IP ${clientIp}` : '',
        ].filter(Boolean).join(', ');
        const detail = where ? `, ${where}` : '';
        return {
            code: 'EGP_UPSTREAM_BLOCKED',
            retryable: false,
            rayId,
            message: `EGP API returned HTTP 403: Forbidden. Cloudflare blocked this client before the API key was checked (Access Denied, "blocked by our security systems"${detail}). GitHub-hosted runners are being refused; set the Actions variable INGESTION_RUNNER to a self-hosted runner on a Thailand network.`,
        };
    }

    const compact = redacted.replace(/\s+/g, ' ').trim();
    let parsed = null;
    if (compact.startsWith('{')) {
        try {
            parsed = JSON.parse(compact);
        } catch {
            parsed = null;
        }
    }
    const apiMessage = redactSecret(String(parsed?.message || parsed?.error || ''), apiKey).trim();
    const authFailure = [401, 403].includes(status)
        && !compact.startsWith('<')
        && /api[-\s]?key|invalid key|unauthorized/i.test(`${apiMessage} ${compact.slice(0, 500)}`);
    if (authFailure) {
        const detail = apiMessage ? ` ${apiMessage}` : '';
        return {
            code: 'EGP_AUTH_FAILED',
            retryable: false,
            message: `EGP API returned HTTP ${status}: ${statusText || 'auth failure'}.${detail} The API checked the key and rejected it. Rotate the EGP_API_KEY repository secret.`,
        };
    }

    const transient = TRANSIENT_HTTP_STATUSES.has(Number(status));
    return {
        code: transient ? 'EGP_UPSTREAM_UNAVAILABLE' : 'EGP_HTTP_ERROR',
        message: `EGP API returned HTTP ${status}: ${statusText}. Body: ${compact.slice(0, 200)}`,
    };
}

/**
 * Ask the edge whether this network can reach e-GP at all. No API key is sent.
 * Only the Cloudflare security page is a hard failure; a missing-key JSON
 * response means the request passed the edge.
 *
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [options]
 */
export async function probeEgpEdge({ fetchImpl = fetch, timeoutMs = 20000 } = {}) {
    const url = `${EGP_BASE_URL}?year=2570&limit=1&offset=0`;
    let response;
    try {
        response = await fetchImpl(url, {
            signal: AbortSignal.timeout(timeoutMs),
            headers: {
                'User-Agent': 'MoneyTamNgan/1.0',
                'Accept': 'application/json',
            },
        });
    } catch (error) {
        return { ok: true, skipped: true, reason: error?.message || 'request failed' };
    }

    if (response.ok) return { ok: true, status: response.status };
    const body = await response.text().catch(() => '');
    const described = describeEgpHttpFailure({
        status: response.status,
        statusText: response.statusText,
        body,
    });
    if (described.code === 'EGP_UPSTREAM_BLOCKED') {
        return { ok: false, status: response.status, ...described };
    }
    return { ok: true, status: response.status, code: described.code };
}

/**
 * Thai month abbreviations → month index (0-based).
 */
const THAI_MONTHS = {
    'ม.ค.': 0, 'ก.พ.': 1, 'มี.ค.': 2, 'เม.ย.': 3,
    'พ.ค.': 4, 'มิ.ย.': 5, 'ก.ค.': 6, 'ส.ค.': 7,
    'ก.ย.': 8, 'ต.ค.': 9, 'พ.ย.': 10, 'ธ.ค.': 11,
};

/**
 * Parse a Thai-format date string like "21 มิ.ย. 67" into a JS Date.
 * Thai dates use Buddhist Era (BE) which is Gregorian + 543.
 * Two-digit years: 67 → 2567 BE → 2024 CE.
 *
 * @param {string} dateStr - Thai date string
 * @returns {Date|null}
 */
export function parseThaiDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return null;

    const parts = dateStr.trim().split(/\s+/);
    if (parts.length !== 3) return null;

    const day = parseInt(parts[0], 10);
    const monthIndex = THAI_MONTHS[parts[1]];
    let yearBE = parseInt(parts[2], 10);

    if (isNaN(day) || monthIndex === undefined || isNaN(yearBE)) return null;

    // Handle 2-digit year: if < 100, assume 25xx BE
    if (yearBE < 100) {
        yearBE += 2500;
    }

    // Convert Buddhist Era to Gregorian
    const yearCE = yearBE - 543;

    // Store source dates at UTC midnight so ingestion is deterministic across
    // developer machines and Cloud Run regions.
    const date = new Date(Date.UTC(yearCE, monthIndex, day));
    return isNaN(date.getTime()) ? null : date;
}

/**
 * Fetch projects from the EGP-CONTRACT API.
 *
 * @param {Object} options
 * @param {string} options.year        - Fiscal year, e.g. "2568"
 * @param {string} [options.keyword]   - Optional search keyword
 * @param {number} [options.limit]     - Records per request (max 1000)
 * @param {number} [options.offset]    - Starting offset
 * @param {string} [options.deptCode]  - Optional department code
 * @returns {Promise<{ total: number, records: Object[] }>}
 */
export async function fetchFromEGP({
    year,
    keyword,
    limit = DEFAULT_LIMIT,
    offset = 0,
    deptCode,
} = {}) {
    const apiKey = process.env.EGP_API_KEY;
    if (!apiKey) {
        throw new Error('Please define the EGP_API_KEY environment variable inside .env');
    }

    const params = new URLSearchParams({
        'api-key': apiKey,
        year: year || '2568',
        limit: String(Math.min(limit, MAX_LIMIT)),
        offset: String(offset),
    });

    if (keyword) params.set('keyword', keyword);
    if (deptCode) params.set('dept_code', deptCode);

    const url = `${EGP_BASE_URL}?${params.toString()}`;

    const response = await fetch(url, {
        signal: AbortSignal.timeout(20000),
        headers: {
            'User-Agent': 'MoneyTamNgan/1.0',
            'Accept': 'application/json',
        },
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        const described = describeEgpHttpFailure({
            status: response.status,
            statusText: response.statusText,
            body: text,
            apiKey,
        });
        const error = new Error(described.message);
        error.status = response.status;
        error.code = described.code;
        // A Cloudflare block and a rejected key will not start working on retry.
        // 5xx/429 leave retryable unset so the scheduler treats them as transient.
        if (typeof described.retryable === 'boolean') error.retryable = described.retryable;
        throw error;
    }

    const json = await response.json();

    if (!json.success) {
        throw new Error(`EGP API error: ${json.message || 'Unknown error'}`);
    }

    // The DGA API envelope uses `data` for the data array
    const rawRecords = json.data || json.result || [];
    const total = json.total || rawRecords.length;

    return {
        total,
        records: rawRecords,
    };
}

/**
 * Fetch records from the EGP-CONTRACT API with auto-pagination up to a max cap.
 *
 * @param {Object} options - Same as fetchFromEGP.
 * @param {number} [options.maxRecords] - Maximum total records to fetch (default: 500).
 * @returns {Promise<Object[]>} - All raw records combined, capped at maxRecords.
 */
export async function fetchAllFromEGP(options = {}) {
    const allRecords = [];
    const maxRecords = options.maxRecords || options.limit || DEFAULT_LIMIT;
    const pageSize = Math.min(maxRecords, MAX_LIMIT);
    let offset = options.offset || 0;
    let hasMore = true;

    while (hasMore) {
        // Only fetch as many as we still need
        const remaining = maxRecords - allRecords.length;
        const batchSize = Math.min(pageSize, remaining);

        const { total, records } = await fetchFromEGP({
            ...options,
            limit: batchSize,
            offset,
        });

        allRecords.push(...records);
        offset += batchSize;

        // Stop if: no more records, reached our cap, or got fewer than requested
        hasMore = records.length === batchSize && allRecords.length < maxRecords && allRecords.length < total;

        console.log(`   📥 Fetched ${allRecords.length} / ${Math.min(total, maxRecords)} records (offset=${offset})`);
    }

    return allRecords;
}

/**
 * Calculate the number of days between two Dates.
 * Returns null if either date is missing.
 */
function calcDurationDays(start, end) {
    if (!start || !end) return null;
    return Math.round((end - start) / (1000 * 60 * 60 * 24));
}

/**
 * Transform a single raw EGP-CONTRACT API record into a document
 * matching the Project schema.
 *
 * The EGP API returns nested `contract` array with winner/contract details.
 * We extract the first contract entry for timeline dates.
 *
 * @param {Object} raw - Raw record from the EGP API
 * @returns {Object} - Document ready for Project.create() / upsert
 */
export function mapToProjectSchema(raw) {
    if (!raw?.project_id || !raw?.project_name || !raw?.dept_name) {
        throw new TypeError('EGP record must contain project_id, project_name, and dept_name');
    }

    const announceDate = parseThaiDate(raw.announce_date);

    // Extract contract details from the first contract entry
    const firstContract = raw.contract?.[0] || {};
    const contractStart = parseThaiDate(firstContract.contract_date);
    const contractEnd = parseThaiDate(firstContract.contract_finish_date);
    const durationDays = calcDurationDays(contractStart, contractEnd);

    const project = {
        project_id: raw.project_id,
        project_name: raw.project_name,
        dept_name: raw.dept_name,
        ...(raw.dept_sub_name ? { dept_sub_name: raw.dept_sub_name } : {}),
        budget: Number(raw.project_money) || Number(raw.price_build) || 0,
        project_status: raw.project_status || 'Active',
        timeline: {
            announce_date: announceDate,
            contract_start: contractStart,
            contract_end: contractEnd,
            duration_days: durationDays,
        },
        source: {
            provider: 'egp_open_data',
            fetched_at: new Date(),
            payload_hash: createHash('sha256')
                .update(JSON.stringify(raw))
                .digest('hex'),
            ...(/^\d{4}$/.test(String(raw.rss_dept_id || raw.dept_id || ''))
                ? { rss_dept_id: String(raw.rss_dept_id || raw.dept_id) } : {}),
        },
    };

    return project;
}

/**
 * Build a non-destructive MongoDB upsert. Metadata is refreshed while fields
 * owned by document processing and Vertex extraction are initialized only on
 * first insert.
 */
export function buildProjectUpsert(raw) {
    const project = mapToProjectSchema(raw);
    const {
        project_id: projectId,
        timeline,
        source,
        ...metadata
    } = project;
    const metadataSet = {
        ...metadata,
        'source.provider': source.provider,
        'source.fetched_at': source.fetched_at,
        'source.payload_hash': source.payload_hash,
        ...(source.rss_dept_id ? { 'source.rss_dept_id': source.rss_dept_id } : {}),
    };
    for (const [field, value] of Object.entries(timeline)) {
        // A contract API response can temporarily omit nested dates. Updating
        // only values actually present prevents that from erasing known dates.
        if (value !== null && value !== undefined) {
            metadataSet[`timeline.${field}`] = value;
        }
    }

    return {
        filter: { project_id: projectId },
        update: {
            $set: metadataSet,
            $setOnInsert: {
                project_id: projectId,
                is_software: null,
                'classification.status': 'pending',
                'processing.status': 'metadata_ingested',
                'processing.attempts': 0,
                'workflow.status': 'metadata_ingested',
                'anomalies.high_budget_flag': false,
                'anomalies.budget_deviation_multiplier': 1,
            },
        },
    };
}

/**
 * Transform an array of raw EGP records into Project-schema documents.
 *
 * @param {Object[]} rawRecords
 * @returns {Object[]}
 */
export function mapAllToProjectSchema(rawRecords) {
    return rawRecords.map(mapToProjectSchema);
}
