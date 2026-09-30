export const TOR_PROMPT_VERSION = 'tor-thai-risk-v4';

export const TOR_RISK_CATEGORIES = [
    'unrealistic_tenure',
    'excessive_hardware',
    'vendor_lock_in',
];

export const TOR_RISK_SEVERITIES = ['low', 'medium', 'high'];

const evidenceItem = {
    type: 'OBJECT',
    properties: {
        value: { type: 'STRING' },
        page: { type: 'INTEGER', minimum: 1 },
    },
    required: ['value', 'page'],
};

export const TOR_RESPONSE_SCHEMA = {
    type: 'OBJECT',
    properties: {
        summary: { type: 'STRING' },
        qualifications: { type: 'ARRAY', items: evidenceItem },
        scope_of_work: { type: 'ARRAY', items: evidenceItem },
        tech_stack: { type: 'ARRAY', items: evidenceItem },
        flagged_clauses: {
            type: 'ARRAY',
            items: {
                type: 'OBJECT',
                properties: {
                    clause_text: { type: 'STRING' },
                    reason: { type: 'STRING' },
                    page: { type: 'INTEGER', minimum: 1 },
                },
                required: ['clause_text', 'reason', 'page'],
            },
        },
        risk_findings: {
            type: 'ARRAY',
            items: {
                type: 'OBJECT',
                properties: {
                    category: { type: 'STRING', enum: TOR_RISK_CATEGORIES },
                    severity: { type: 'STRING', enum: TOR_RISK_SEVERITIES },
                    clause_text: { type: 'STRING' },
                    explanation: { type: 'STRING' },
                    highlight_reason: { type: 'STRING' },
                    page: { type: 'INTEGER', minimum: 1 },
                    confidence: { type: 'NUMBER', minimum: 0, maximum: 1 },
                },
                required: [
                    'category', 'severity', 'clause_text', 'explanation',
                    'highlight_reason', 'page', 'confidence',
                ],
            },
        },
        confidence: { type: 'NUMBER', minimum: 0, maximum: 1 },
        document_language: { type: 'STRING' },
    },
    required: [
        'summary', 'qualifications', 'scope_of_work', 'tech_stack',
        'flagged_clauses', 'risk_findings', 'confidence', 'document_language',
    ],
};

export function validateTorExtraction(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Vertex extraction must be a JSON object');
    }
    if (typeof value.summary !== 'string') throw new Error('Vertex summary must be a string');
    if (!Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) {
        throw new Error('Vertex confidence must be between 0 and 1');
    }

    for (const field of ['qualifications', 'scope_of_work', 'tech_stack']) {
        if (!Array.isArray(value[field])) throw new Error(`Vertex ${field} must be an array`);
        value[field] = value[field]
            .filter(item => item && typeof item.value === 'string' && item.value.trim())
            .map(item => ({
                value: item.value.trim(),
                ...(Number.isInteger(item.page) && item.page > 0 ? { page: item.page } : {}),
            }));
    }

    if (!Array.isArray(value.flagged_clauses)) {
        throw new Error('Vertex flagged_clauses must be an array');
    }
    value.flagged_clauses = value.flagged_clauses
        .filter(item => item && typeof item.clause_text === 'string' && typeof item.reason === 'string')
        .map(item => ({
            clause_text: item.clause_text.trim(),
            reason: item.reason.trim(),
            ...(Number.isInteger(item.page) && item.page > 0 ? { page: item.page } : {}),
        }));

    if (!Array.isArray(value.risk_findings)) {
        throw new Error('Vertex risk_findings must be an array');
    }
    value.risk_findings = value.risk_findings.map((item, index) => {
        const label = `Vertex risk_findings[${index}]`;
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            throw new Error(`${label} must be an object`);
        }
        if (!TOR_RISK_CATEGORIES.includes(item.category)) {
            throw new Error(`${label}.category is invalid`);
        }
        if (!TOR_RISK_SEVERITIES.includes(item.severity)) {
            throw new Error(`${label}.severity is invalid`);
        }
        for (const field of ['clause_text', 'explanation', 'highlight_reason']) {
            if (typeof item[field] !== 'string' || !item[field].trim()) {
                throw new Error(`${label}.${field} must be a non-empty string`);
            }
        }
        if (!Number.isInteger(item.page) || item.page < 1) {
            throw new Error(`${label}.page must be a positive integer`);
        }
        if (!Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) {
            throw new Error(`${label}.confidence must be between 0 and 1`);
        }
        return {
            category: item.category,
            severity: item.severity,
            clause_text: item.clause_text.trim(),
            explanation: item.explanation.trim(),
            highlight_reason: item.highlight_reason.trim(),
            page: item.page,
            confidence: item.confidence,
        };
    });
    return value;
}
