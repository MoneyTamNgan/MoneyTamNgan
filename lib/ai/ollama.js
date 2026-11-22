/**
 * Local AI provider. When AI_PROVIDER=ollama the Gemini-shaped requests built
 * for Vertex (TOR extraction, proposal drafts) are translated to Ollama's
 * /api/chat and the answer is translated back, so callers stay unchanged.
 *
 *   AI_PROVIDER=ollama
 *   OLLAMA_BASE_URL=http://10.0.0.5:11434
 *   VERTEX_MODEL=qwen2.5:3b          (the model name is reused)
 *   OLLAMA_NUM_CTX=8192              (optional)
 */
/** "agy" is another name for the same Ollama-protocol path: the agy bridge (docs/agy-bridge.md) speaks it. */
export function isOllamaProtocolName(value) {
    return ['ollama', 'agy'].includes(String(value || '').toLowerCase());
}

export function aiProvider(env = process.env) {
    return isOllamaProtocolName(env.AI_PROVIDER) ? 'ollama' : 'vertex';
}

/** AGY_BASE_URL (the agy bridge) wins over OLLAMA_BASE_URL (a local Ollama server). */
export function ollamaBaseUrl(env = process.env) {
    return String(env.AGY_BASE_URL || env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
}

export function ollamaEndpoint(model, env = process.env) {
    return `${ollamaBaseUrl(env)}/api/chat?model=${encodeURIComponent(model)}`;
}

const SCHEMA_KEYS = new Set([
    'type', 'properties', 'items', 'required', 'enum', 'minimum', 'maximum',
    'minItems', 'maxItems', 'minLength', 'maxLength', 'description', 'additionalProperties',
]);

/** Gemini schemas use upper-case types (OBJECT, STRING); JSON Schema wants lower-case. */
export function toJsonSchema(schema) {
    if (Array.isArray(schema)) return schema.map(toJsonSchema);
    if (!schema || typeof schema !== 'object') return schema;
    const out = {};
    for (const [key, value] of Object.entries(schema)) {
        if (key === 'properties' && value && typeof value === 'object') {
            out.properties = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toJsonSchema(v)]));
        } else if (key === 'type' && typeof value === 'string') {
            out.type = value.toLowerCase();
        } else if (SCHEMA_KEYS.has(key)) {
            out[key] = toJsonSchema(value);
        } else if (key === 'nullable' && value === true && typeof schema.type === 'string') {
            out.type = [schema.type.toLowerCase(), 'null'];
        }
    }
    return out;
}

const partsText = parts => (parts || []).map(part => part?.text || '').join('');

export function geminiToOllama(body, model, env = process.env) {
    const messages = [];
    const system = partsText(body.systemInstruction?.parts);
    if (system) messages.push({ role: 'system', content: system });
    for (const item of body.contents || []) {
        messages.push({ role: item.role === 'model' ? 'assistant' : 'user', content: partsText(item.parts) });
    }
    const config = body.generationConfig || {};
    const request = {
        model,
        messages,
        stream: false,
        options: {
            temperature: typeof config.temperature === 'number' ? config.temperature : 0.1,
            num_ctx: Number(env.OLLAMA_NUM_CTX) || 8192,
        },
    };
    if (config.responseSchema) request.format = toJsonSchema(config.responseSchema);
    else if (config.responseMimeType === 'application/json') request.format = 'json';
    return request;
}

export function ollamaToGemini(payload, model) {
    const text = payload?.message?.content || '';
    const finished = payload?.done !== false && (payload?.done_reason || 'stop') === 'stop';
    return {
        candidates: [{
            finishReason: finished ? 'STOP' : 'MAX_TOKENS',
            content: { parts: [{ text }] },
        }],
        modelVersion: payload?.model || model,
    };
}

/** fetch() stand-in that speaks Gemini on the outside and Ollama on the inside. */
export async function ollamaFetch(url, options = {}, fetchImpl = fetch, env = process.env) {
    const model = new URL(url).searchParams.get('model') || env.VERTEX_MODEL;
    const body = typeof options.body === 'string' ? JSON.parse(options.body) : {};
    const response = await fetchImpl(`${ollamaBaseUrl(env)}/api/chat`, {
        ...options,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiToOllama(body, model, env)),
    });
    if (!response.ok) return response;
    const payload = await response.json().catch(() => ({}));
    return new Response(JSON.stringify(ollamaToGemini(payload, model)), {
        status: 200, headers: { 'Content-Type': 'application/json' },
    });
}
