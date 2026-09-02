import Keyword from '../models/Keyword.js';
import {
    DEFAULT_SOFTWARE_KEYWORDS,
    DEFAULT_NON_SOFTWARE_KEYWORDS,
} from './classification.js';

/**
 * DB-backed classification keyword rules (FR-1.2).
 *
 * The keyword lists used to live only in `lib/classification.js`. This module
 * moves them into MongoDB so an admin can edit them at runtime, while keeping
 * the hard-coded lists as the seed / offline fallback.
 *
 * Callers must have an open mongoose connection (`await connectDB()`), except
 * `loadKeywordSets`, which degrades to the built-in defaults if the DB is
 * unreachable so classification never hard-fails.
 */

function defaultSets() {
    return {
        softwareKeywords: [...DEFAULT_SOFTWARE_KEYWORDS],
        nonSoftwareKeywords: [...DEFAULT_NON_SOFTWARE_KEYWORDS],
    };
}

/** Copy the built-in keyword lists into the collection the first time it is used. */
export async function seedKeywordsIfEmpty() {
    const count = await Keyword.estimatedDocumentCount();
    if (count > 0) return;

    const docs = [
        ...DEFAULT_SOFTWARE_KEYWORDS.map((keyword) => ({ keyword, category: 'software' })),
        ...DEFAULT_NON_SOFTWARE_KEYWORDS.map((keyword) => ({ keyword, category: 'non-software' })),
    ];
    // ordered:false so a concurrent seed racing us on the unique index is a no-op.
    await Keyword.insertMany(docs, { ordered: false }).catch(() => {});
}

/**
 * Read every keyword rule and split it into the two arrays `classifyTor` takes.
 * @returns {Promise<{ softwareKeywords: string[], nonSoftwareKeywords: string[] }>}
 */
export async function loadKeywordSets() {
    try {
        await seedKeywordsIfEmpty();
        const all = await Keyword.find().lean();
        if (all.length === 0) return defaultSets();
        return {
            softwareKeywords: all
                .filter((k) => k.category === 'software')
                .map((k) => k.keyword),
            nonSoftwareKeywords: all
                .filter((k) => k.category === 'non-software')
                .map((k) => k.keyword),
        };
    } catch {
        return defaultSets();
    }
}
