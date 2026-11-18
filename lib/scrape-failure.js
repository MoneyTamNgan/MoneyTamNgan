/** Stable, non-sensitive acquisition diagnostics. Never persist upstream messages. */
export const FAILURE_MESSAGES = Object.freeze({
    anti_bot_blocked: 'Official site requires human verification or denied access.',
    temporary_timeout: 'Document acquisition timed out.',
    resolver_failed: 'Official project detail URL could not be resolved.',
    unsupported_layout: 'Official document layout is not supported.',
    archive_invalid: 'Archive is corrupt or contains no usable PDF.',
    file_too_large: 'Document or archive exceeded a configured safety limit.',
    unreadable_pdf: 'PDF is corrupt, encrypted or unreadable; manual review required.',
    download_failed: 'Document download failed or the upstream service is unavailable.',
    document_not_published: 'No published TOR document was found.',
    text_extraction_failed: 'Text extraction failed; check OCR tooling and language files.',
    failed: 'Document acquisition failed; inspect the reason code and retry policy.',
});
export function classifyScrapeFailure(error) {
    if (Object.hasOwn(FAILURE_MESSAGES, error?.outcome)) return {
        outcome: error.outcome, retryable: error.retryable ?? !['resolver_failed', 'unsupported_layout', 'archive_invalid', 'file_too_large', 'unreadable_pdf', 'document_not_published'].includes(error.outcome),
    };
    const message = String(error?.message || error || '');
    if (/cloudflare|captcha|anti-?bot|access denied/i.test(message)) return { outcome: 'anti_bot_blocked', retryable: true };
    if (error?.name === 'TimeoutError' || /timed?\s*out|timeout|waiting failed.*exceeded|operation was aborted/i.test(message)) return { outcome: 'temporary_timeout', retryable: true };
    if (/larger than|too large|exceed.*limit|more than \d+ entries|compression ratio|per-file extraction limit/i.test(message)) return { outcome: 'file_too_large', retryable: false };
    if (/no official e-GP detail link|aggregator|resolv/i.test(message)) return { outcome: 'resolver_failed', retryable: false };
    if (/unsupported.*layout|document layout|empty page after/i.test(message)) return { outcome: 'unsupported_layout', retryable: false };
    if (/archive|ZIP|no valid PDF|central directory/i.test(message)) return { outcome: 'archive_invalid', retryable: false };
    if (/PDF.*(?:signature|corrupt|invalid|unreadable|encrypted)|document is empty|unsupported signature|password.*PDF|syntax error|no pages/i.test(message)) return { outcome: 'unreadable_pdf', retryable: false };
    if (/OCR|tesseract|pdftotext|missing tha/i.test(message)) return { outcome: 'text_extraction_failed', retryable: true };
    if (/download|document link|HTTP (?:429|5\d\d)|ECONN|ENOTFOUND|EAI_AGAIN|fetch failed|network|socket/i.test(message)) return { outcome: 'download_failed', retryable: true };
    return { outcome: 'failed', retryable: error?.retryable ?? true };
}
export function safeScrapeMessage(error) {
    return FAILURE_MESSAGES[classifyScrapeFailure(error).outcome];
}
export function acquisitionError(error) {
    const failure = classifyScrapeFailure(error);
    return Object.assign(new Error(FAILURE_MESSAGES[failure.outcome]), failure, { code: failure.outcome });
}

/** Worker logs also cover cloud/storage stages; retain useful categories safely. */
export function safePipelineMessage(error) {
    const text = String(error?.message || error || '');
    if (/RESOURCE_EXHAUSTED|quota|HTTP 429/i.test(text)) return 'Cloud capacity or quota unavailable; bounded retry or operator review required.';
    if (/PERMISSION_DENIED|billing|HTTP 403/i.test(text)) return 'Cloud authorization or billing unavailable; operator configuration required.';
    if (/UNAUTHENTICATED|credentials|HTTP 401/i.test(text)) return 'Cloud credentials unavailable or invalid; operator configuration required.';
    if (/Mongo|querySrv|EBADRESP/i.test(error?.name || '') || /querySrv|EBADRESP|server selection/i.test(text)) return 'Database connection unavailable; check network access.';
    const failure = classifyScrapeFailure(error);
    return failure.outcome === 'failed' ? 'Pipeline operation failed; inspect its stage and reason code.' : FAILURE_MESSAGES[failure.outcome];
}
