/**
 * Software / non-software classification for ingested TOR documents (FR-1.2).
 *
 * This is a lightweight keyword classifier. It reads the free-text fields of a
 * TOR (project name + any extracted summary / scope text) and decides whether
 * the procurement is a software project.
 *
 * Output maps directly onto the Project schema:
 *   - is_software: true | false | null   (null = could not decide, needs manual review)
 *   - classification_confidence: 0..1 | null
 *
 * The keyword lists mirror the `software` / `non-software` categories in the
 * admin classification-keywords endpoint (see docs/api/openapi.yaml). They are
 * exported so an admin screen / DB-backed list can override them later.
 */

export const DEFAULT_SOFTWARE_KEYWORDS = [
    'ซอฟต์แวร์',
    'software',
    'พัฒนาระบบ',
    'พัฒนาโปรแกรม',
    'พัฒนาเว็บ',
    'พัฒนาแอปพลิเคชัน',
    'แอปพลิเคชัน',
    'application',
    'โมบายแอป',
    'mobile app',
    'เว็บไซต์',
    'website',
    'web application',
    'ระบบสารสนเทศ',
    'information system',
    'ระบบฐานข้อมูล',
    'database',
    'จัดทำระบบ',
    'ระบบบริหารจัดการ',
    'แพลตฟอร์ม',
    'platform',
    'api',
    'คลาวด์',
    'cloud',
    'dashboard',
    'แดชบอร์ด',
    'ปัญญาประดิษฐ์',
    'ai',
    'machine learning',
    'บิ๊กดาต้า',
    'big data',
    'ดิจิทัล',
    'digital',
];

export const DEFAULT_NON_SOFTWARE_KEYWORDS = [
    'ก่อสร้าง',
    'ปรับปรุงอาคาร',
    'ต่อเติมอาคาร',
    'ซ่อมแซมถนน',
    'งานถนน',
    'งานโยธา',
    'ปูพื้น',
    'ทาสี',
    'ระบบประปา',
    'ระบบไฟฟ้าแรงสูง',
    'จัดซื้อครุภัณฑ์',
    'จัดซื้อวัสดุ',
    'เช่ารถ',
    'เช่ารถยนต์',
    'ยานพาหนะ',
    'เครื่องปรับอากาศ',
    'เฟอร์นิเจอร์',
    'จ้างเหมาบริการทำความสะอาด',
    'รักษาความปลอดภัย',
    'กำจัดขยะ',
    'ดูแลต้นไม้',
    'ภูมิทัศน์',
    'อาหาร',
    'เครื่องแต่งกาย',
    'เครื่องเขียน',
];

/** Collapse a TOR document into one lowercase string for matching. */
function toSearchText(tor = {}) {
    const parts = [
        tor.project_name,
        tor.dept_name,
        tor.dept_sub_name,
        tor.extracted_data?.summary,
        ...(tor.extracted_data?.scope_of_work ?? []),
        ...(tor.extracted_data?.tech_stack ?? []),
    ];
    return parts.filter(Boolean).join(' ').toLowerCase();
}

function countMatches(text, keywords) {
    const seen = new Set();
    for (const kw of keywords) {
        if (text.includes(kw.toLowerCase())) seen.add(kw.toLowerCase());
    }
    return seen.size;
}

/**
 * Classify a single TOR.
 *
 * @param {Object} tor - a document shaped like the Project schema (pre-insert is fine)
 * @param {Object} [opts]
 * @param {string[]} [opts.softwareKeywords]
 * @param {string[]} [opts.nonSoftwareKeywords]
 * @returns {{ is_software: (boolean|null), classification_confidence: (number|null) }}
 */
export function classifyTor(tor, opts = {}) {
    const softwareKeywords = opts.softwareKeywords ?? DEFAULT_SOFTWARE_KEYWORDS;
    const nonSoftwareKeywords = opts.nonSoftwareKeywords ?? DEFAULT_NON_SOFTWARE_KEYWORDS;

    const text = toSearchText(tor);
    if (!text) return { is_software: null, classification_confidence: null };

    const softHits = countMatches(text, softwareKeywords);
    const nonSoftHits = countMatches(text, nonSoftwareKeywords);

    // No signal either way -> leave for manual review.
    if (softHits === 0 && nonSoftHits === 0) {
        return { is_software: null, classification_confidence: null };
    }

    // Contradictory signal of equal weight -> also manual review.
    if (softHits === nonSoftHits) {
        return { is_software: null, classification_confidence: null };
    }

    const isSoftware = softHits > nonSoftHits;
    const winning = Math.max(softHits, nonSoftHits);
    const losing = Math.min(softHits, nonSoftHits);

    // More winning hits -> higher confidence; any opposing hits pull it back down.
    let confidence = 0.5 + 0.15 * winning - 0.1 * losing;
    confidence = Math.max(0.5, Math.min(0.95, confidence));

    return {
        is_software: isSoftware,
        classification_confidence: Number(confidence.toFixed(2)),
    };
}

/**
 * Return a copy of a TOR document with the classification fields filled in.
 * Ingestion code calls this right before Project.create() / upsert so that
 * every stored record has `is_software` explicitly set (DoD for this card).
 *
 * An already-set `is_software` (e.g. a manual admin override) is preserved.
 *
 * @param {Object} tor
 * @param {Object} [opts] - forwarded to classifyTor
 * @returns {Object}
 */
export function applySoftwareFlag(tor, opts = {}) {
    if (tor && (tor.is_software === true || tor.is_software === false)) {
        return {
            ...tor,
            classification_confidence: tor.classification_confidence ?? null,
        };
    }
    const { is_software, classification_confidence } = classifyTor(tor ?? {}, opts);
    return { ...tor, is_software, classification_confidence };
}
