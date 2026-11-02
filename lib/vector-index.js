import { VECTOR_FIELD } from './embedding-config.js';

export const VECTOR_INDEX_NAME = 'project_vector_index';

export function vectorIndexDefinition(dimensions) {
    return {
        fields: [
            { type: 'vector', path: VECTOR_FIELD, numDimensions: dimensions, similarity: 'cosine' },
            // Pre-filters so semantic queries can be scoped without a post-filter.
            { type: 'filter', path: 'is_software' },
            { type: 'filter', path: 'dept_name' },
        ],
    };
}

/**
 * Create the Atlas Vector Search index on the projects collection, or update it
 * if the vector settings changed. Needs Atlas (or an Atlas local deployment):
 * a plain mongod rejects search-index commands.
 *
 * @returns {Promise<'created' | 'updated' | 'unchanged'>}
 */
export async function ensureVectorSearchIndex(collection, { dimensions = 768, name = VECTOR_INDEX_NAME } = {}) {
    const definition = vectorIndexDefinition(dimensions);
    const [existing] = await collection.listSearchIndexes(name).toArray();
    if (!existing) {
        await collection.createSearchIndex({ name, type: 'vectorSearch', definition });
        return 'created';
    }
    const current = existing.latestDefinition?.fields?.find(field => field.type === 'vector');
    if (current?.path === VECTOR_FIELD && current.numDimensions === dimensions && current.similarity === 'cosine') {
        return 'unchanged';
    }
    await collection.updateSearchIndex(name, definition);
    return 'updated';
}
