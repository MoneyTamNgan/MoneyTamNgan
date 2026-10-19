/** Keep short readable clauses and numeric table lines, but never submit broken-font text. */
export function prepareReadablePages(input) {
    const pages = [], skipped = [];
    const source = Array.isArray(input) ? input : [];
    for (const page of source) {
        const number = Number.isInteger(page?.page_number) && page.page_number > 0 ? page.page_number : null;
        if (!number) { skipped.push({ page_number: null, reason: 'invalid_page_number' }); continue; }
        if (typeof page.text !== 'string' || !page.text.trim()) {
            skipped.push({ page_number: number, reason: 'empty_text' }); continue;
        }
        let removed = false;
        const text = page.text.split('\n').filter(line => {
            const compact = line.replace(/\s/g, '');
            const bad = (compact.match(/[\uFFFD\uE000-\uF8FF]/g) || []).length;
            if (compact.length && bad / compact.length >= 0.02) { removed = true; return false; }
            return true;
        }).join('\n');
        const compact = text.replace(/\s/g, '');
        const readable = /\p{L}/u.test(compact)
            && (compact.match(/[\p{L}\p{M}\p{N}]/gu) || []).length / compact.length >= 0.5;
        if (!readable) { skipped.push({ page_number: number, reason: 'unreadable_text' }); continue; }
        if (removed) skipped.push({ page_number: number, reason: 'unreadable_sections' });
        pages.push({ page_number: number, text });
    }
    return { pages, coverage: {
        status: !pages.length ? 'unreadable' : skipped.length ? 'partial' : 'complete',
        total_pages: source.length, readable_pages: pages.length, skipped_pages: skipped,
    } };
}
