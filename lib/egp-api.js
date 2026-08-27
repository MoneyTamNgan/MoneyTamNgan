/**
 * EGP-CONTRACT API Service
 *
 * Fetches government procurement project data from the Open Government Data
 * of Thailand (opend.data.go.th) EGP-CONTRACT endpoint and transforms the
 * response to match the Project schema.
 */

const EGP_BASE_URL = 'https://opend.data.go.th/govspending/service/egp-contract';
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 1000;

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
function parseThaiDate(dateStr) {
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

    const date = new Date(yearCE, monthIndex, day);
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
        headers: {
            'User-Agent': 'MoneyTamNgan/1.0',
            'Accept': 'application/json',
        },
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`EGP API returned HTTP ${response.status}: ${response.statusText}. Body: ${text.slice(0, 200)}`);
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
    const announceDate = parseThaiDate(raw.announce_date);

    // Extract contract details from the first contract entry
    const firstContract = raw.contract?.[0] || {};
    const contractStart = parseThaiDate(firstContract.contract_date);
    const contractEnd = parseThaiDate(firstContract.contract_finish_date);
    const durationDays = calcDurationDays(contractStart, contractEnd);

    return {
        project_id: raw.project_id,
        project_name: raw.project_name,
        dept_name: raw.dept_name,
        dept_sub_name: raw.dept_sub_name || null,
        budget: Number(raw.project_money) || Number(raw.price_build) || 0,
        project_status: raw.project_status || 'Active',
        is_software: null, // Will be classified later (FR-1.2)

        timeline: {
            announce_date: announceDate,
            contract_start: contractStart,
            contract_end: contractEnd,
            duration_days: durationDays,
        },

        pdf_url: raw.pdf_url || null,

        // These fields are populated later by other systems (OCR/LLM, anomaly detection)
        extracted_data: {
            summary: null,
            qualifications: [],
            scope_of_work: [],
            tech_stack: [],
        },

        anomalies: {
            high_budget_flag: false,
            budget_deviation_multiplier: 1.0,
            flagged_clauses: [],
        },

        version_info: {
            version: 1,
            is_latest: true,
            superseded_by: null,
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
