import { fileAsBase64 } from '../document-storage.js';
import {
    TOR_PROMPT_VERSION,
    TOR_RESPONSE_SCHEMA,
    validateTorExtraction,
} from './response-schema.js';

const PROMPT = `
You extract facts from Thai government Terms of Reference documents.
Return only facts supported by this document. Never invent missing details.
Write the summary in Thai. Keep qualifications and scope clauses concise but
faithful. Include the PDF page number whenever it is visible. Identify named
software, platforms, databases, programming languages, cloud products, and
technical standards in tech_stack. If a field is absent, return an empty array.
Flag potentially restrictive or unusually vendor-specific clauses, but explain
the reason neutrally. Confidence must reflect the completeness and readability
of this document, not general model confidence.
`;

function vertexEndpoint(projectId, location, model) {
    const host = location === 'global'
        ? 'aiplatform.googleapis.com'
        : `${location}-aiplatform.googleapis.com`;
    return `https://${host}/v1/projects/${encodeURIComponent(projectId)}`
        + `/locations/${encodeURIComponent(location)}/publishers/google/models/`
        + `${encodeURIComponent(model)}:generateContent`;
}
async function accessHeaders() {
    const { GoogleAuth } = await import('google-auth-library');
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const client = await auth.getClient();
    return client.getRequestHeaders();
}

export async function extractTorWithVertex({ gcsUri, localPath, mimeType = 'application/pdf' }) {
    const projectId = process.env.GOOGLE_CLOUD_PROJECT;
    const location = process.env.GOOGLE_CLOUD_LOCATION || 'global';
    const model = process.env.VERTEX_MODEL || 'gemini-2.5-flash';
    if (!projectId) throw new Error('GOOGLE_CLOUD_PROJECT is required for Vertex extraction');

    const documentPart = gcsUri
        ? { fileData: { fileUri: gcsUri, mimeType } }
        : { inlineData: { data: await fileAsBase64(localPath), mimeType } };

    const response = await fetch(vertexEndpoint(projectId, location, model), {
        method: 'POST',
        headers: {
            ...(await accessHeaders()),
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            contents: [{ role: 'user', parts: [documentPart, { text: PROMPT }] }],
            generationConfig: {
                temperature: 0.1,
                responseMimeType: 'application/json',
                responseSchema: TOR_RESPONSE_SCHEMA,
            },
        }),
        signal: AbortSignal.timeout(Number(process.env.VERTEX_TIMEOUT_MS || 120000)),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(`Vertex returned HTTP ${response.status}: ${payload?.error?.message || 'Unknown error'}`);
    }
    const text = payload.candidates?.[0]?.content?.parts
        ?.map(part => part.text || '')
        .join('')
        .trim();
    if (!text) throw new Error('Vertex returned no extraction content');

    let extraction;
    try {
        extraction = JSON.parse(text);
    } catch {
        throw new Error('Vertex returned invalid JSON');
    }

    return {
        extraction: validateTorExtraction(extraction),
        model,
        modelVersion: payload.modelVersion || model,
        promptVersion: TOR_PROMPT_VERSION,
        usage: {
            inputTokens: payload.usageMetadata?.promptTokenCount || 0,
            outputTokens: payload.usageMetadata?.candidatesTokenCount || 0,
        },
    };
}
