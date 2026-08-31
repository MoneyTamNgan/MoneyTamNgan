export const TOR_PROMPT_VERSION = 'tor-extraction-v1';

const evidenceItem = {
    type: 'OBJECT',
    properties: {
        value: { type: 'STRING' },
        page: { type: 'INTEGER', minimum: 1 },
    },
    required: ['value'],
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
                required: ['clause_text', 'reason'],
            },
        },
        confidence: { type: 'NUMBER', minimum: 0, maximum: 1 },
        document_language: { type: 'STRING' },
    },
    required: [
        'summary', 'qualifications', 'scope_of_work', 'tech_stack',
        'flagged_clauses', 'confidence', 'document_language',
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
    return value;
}
