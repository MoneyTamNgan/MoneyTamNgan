/**
 * Settings for TOR text embeddings (FR-2.3.1). Kept free of heavy imports so
 * index scripts can read the vector dimensions without loading the Vertex client.
 */
export const VECTOR_FIELD = 'vectorEmbedding';

export function embeddingConfig(env = process.env) {
    return {
        enabled: String(env.VERTEX_AI_ENABLED || '').toLowerCase() === 'true',
        projectId: env.GOOGLE_CLOUD_PROJECT,
        // text-embedding-005 is served from regional endpoints, unlike the
        // 'global' location used for Gemini extraction.
        location: env.VERTEX_EMBEDDING_LOCATION || 'us-central1',
        model: env.VERTEX_EMBEDDING_MODEL || 'text-embedding-005',
        dimensions: Number(env.VERTEX_EMBEDDING_DIMENSIONS) || 768,
    };
}
