const SOFTWARE_TERMS = [
    'ซอฟต์แวร์', 'ระบบสารสนเทศ', 'พัฒนาระบบ', 'โปรแกรม', 'แอปพลิเคชัน',
    'เว็บไซต์', 'ฐานข้อมูล', 'ดิจิทัล', 'cloud', 'cybersecurity', 'software',
    'application', 'database', 'api', 'server', 'network',
];

const NON_SOFTWARE_TERMS = [
    'ก่อสร้าง', 'ปรับปรุงถนน', 'อาหาร', 'วัสดุก่อสร้าง', 'รถยนต์',
    'เครื่องแบบ', 'เวชภัณฑ์', 'ครุภัณฑ์สำนักงาน', 'น้ำมันเชื้อเพลิง',
];

/**
 * Cheap, deterministic triage before document retrieval. Uncertain projects
 * stay eligible for processing so the keyword rules cannot silently discard
 * a relevant TOR.
 */
export function classifyProjectMetadata(project) {
    const text = [project?.project_name, project?.dept_name, project?.dept_sub_name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    const positiveMatches = SOFTWARE_TERMS.filter(term => text.includes(term.toLowerCase()));
    const negativeMatches = NON_SOFTWARE_TERMS.filter(term => text.includes(term.toLowerCase()));

    if (positiveMatches.length > 0) {
        return {
            status: 'software',
            isSoftware: true,
            confidence: Math.min(0.98, 0.82 + positiveMatches.length * 0.04),
            method: 'metadata_keywords_v1',
            reason: `Matched software terms: ${positiveMatches.join(', ')}`,
        };
    }

    if (negativeMatches.length > 0) {
        return {
            status: 'not_software',
            isSoftware: false,
            confidence: Math.min(0.95, 0.78 + negativeMatches.length * 0.04),
            method: 'metadata_keywords_v1',
            reason: `Matched non-software terms: ${negativeMatches.join(', ')}`,
        };
    }

    return {
        status: 'uncertain',
        isSoftware: null,
        confidence: 0.5,
        method: 'metadata_keywords_v1',
        reason: 'No decisive metadata keyword matched',
    };
}
