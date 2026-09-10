import { classifyTor } from './classification.js';

/**
 * Cheap, deterministic triage before document retrieval. Uncertain projects
 * stay eligible for processing so the keyword rules cannot silently discard
 * a relevant TOR.
 *
 * @param {Object} project
 * @param {{ softwareKeywords?: string[], nonSoftwareKeywords?: string[] }} [keywordSets]
 *   DB-backed keyword lists (see `lib/keywords.js`). Omit to use the built-in defaults.
 */
export function classifyProjectMetadata(project, keywordSets = {}) {
    const result = classifyTor(project, keywordSets);
    if (result.is_software === true) {
        return {
            status: 'software',
            isSoftware: true,
            confidence: result.classification_confidence,
            method: 'upstream_keyword_classifier',
            reason: 'Software keyword signals outweighed non-software signals',
        };
    }
    if (result.is_software === false) {
        return {
            status: 'not_software',
            isSoftware: false,
            confidence: result.classification_confidence,
            method: 'upstream_keyword_classifier',
            reason: 'Non-software keyword signals outweighed software signals',
        };
    }
    return {
        status: 'uncertain',
        isSoftware: null,
        confidence: 0.5,
        method: 'upstream_keyword_classifier',
        reason: 'Keyword signals were absent or tied',
    };
}
