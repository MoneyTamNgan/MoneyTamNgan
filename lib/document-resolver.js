import { scrapeProjectTOR } from './scraper.js';
import { validateRemoteDocumentUrl } from './url-safety.js';

export { validateRemoteDocumentUrl } from './url-safety.js';

/** Return known URLs without touching a webpage. */
export function resolveKnownDocumentUrls(project) {
    const raw = [
        project?.document?.source_url
            ? { url: project.document.source_url, source: project.document.source_type || 'cached' }
            : null,
        project?.pdf_url ? { url: project.pdf_url, source: 'egp_api_or_cached' } : null,
    ].filter(Boolean);

    const seen = new Set();
    const candidates = [];
    for (const candidate of raw) {
        try {
            const url = validateRemoteDocumentUrl(candidate.url);
            if (seen.has(url)) continue;
            seen.add(url);
            candidates.push({ ...candidate, url });
        } catch {
            // Invalid persisted URLs are ignored and replaced by later sources.
        }
    }
    return candidates;
}

/** Last-resort browser adapter, intentionally isolated from API-first logic. */
export async function resolveWithBrowser(projectId, options = {}) {
    return scrapeProjectTOR(projectId, null, {
        knownPdfUrl: options.knownPdfUrl,
        storageDir: options.storageDir,
    });
}
