import { sanitizePlainText } from './text.js';

export const DRAFT_LIMITS = Object.freeze({ sections: 100, sources: 20, title: 200, heading: 200, body: 8000, source: 200, total: 100000 });
const fail = (status, message) => ({ status, code: status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INVALID_DRAFT', message });
const has = (object, field) => Object.prototype.hasOwnProperty.call(object, field);

export function parseDraftContent(body, { projectRequired }) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'Draft must be an object.');
    let chars = 0;
    const line = (value, max, label) => {
        if (value === undefined) return '';
        if (typeof value !== 'string') throw fail(400, `${label} must be text.`);
        if (value.length > max) throw fail(400, `${label} must be at most ${max} characters.`);
        const cleaned = sanitizePlainText(value, max);
        chars += cleaned.length;
        if (chars > DRAFT_LIMITS.total) throw fail(413, 'Draft content is too large.');
        return cleaned;
    };
    try {
        const title = line(body.title, DRAFT_LIMITS.title, 'title');
        if (projectRequired && (typeof body.projectId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(body.projectId))) return fail(400, 'projectId is not valid.');
        if (!has(body, 'sections')) return { title, projectId: projectRequired ? body.projectId : '', sections: null };
        if (!Array.isArray(body.sections) || body.sections.length > DRAFT_LIMITS.sections) return fail(400, `sections must be a list of at most ${DRAFT_LIMITS.sections} items.`);
        const sections = body.sections.map(section => {
            if (!section || typeof section !== 'object' || Array.isArray(section)) throw fail(400, 'Each section must be an object.');
            if (has(section, 'sources') && (!Array.isArray(section.sources) || section.sources.length > DRAFT_LIMITS.sources)) throw fail(400, 'Each section has at most 20 text sources.');
            return { heading: line(section.heading, DRAFT_LIMITS.heading, 'heading'), body: line(section.body, DRAFT_LIMITS.body, 'body'),
                sources: (section.sources || []).map(source => line(source, DRAFT_LIMITS.source, 'source')).filter(Boolean) };
        });
        return { title, projectId: projectRequired ? body.projectId : '', sections };
    } catch (error) { return error.code ? error : fail(400, 'Invalid draft.'); }
}

export function draftPlaceholders(draft) {
    return [draft?.title, ...(draft?.sections || []).flatMap(section => [section.heading, section.body])]
        .flatMap(text => typeof text === 'string' ? (text.match(/\[to fill in(?:\s*:[^\]]*)?\]/gi) || []) : []);
}

export function checklistPassed(checklist) {
    return Boolean(checklist?.items?.length && !checklist.truncated
        && checklist.items.every(item => item.status === 'pass'));
}

export function proposalToSections(proposal) {
    const refs = sources => (sources || []).map(source => source.kind === 'tor_page' ? `tor.page.${source.page}`
        : source.kind === 'profile_field' ? `profile.${source.field}` : '').filter(Boolean);
    const sections = [];
    for (const [key, heading] of [['company_overview', 'ข้อมูลบริษัท'], ['project_understanding', 'ความเข้าใจโครงการ']]) {
        for (const row of proposal?.[key] || []) sections.push({ heading, body: row.text || '', sources: refs(row.sources) });
    }
    for (const row of proposal?.scope_responses || []) {
        // A scope item can be a whole paragraph; keep the heading within the editor limit and keep the full text in the body.
        const item = String(row.scope_item || '').trim();
        const long = item.length > DRAFT_LIMITS.heading;
        sections.push({ heading: !item ? 'ขอบเขตงาน' : long ? `${item.slice(0, DRAFT_LIMITS.heading - 1).trimEnd()}…` : item,
            body: long ? `${item}\n\n${row.response || ''}` : row.response || '', sources: refs(row.sources) });
    }
    for (const row of proposal?.past_projects || []) sections.push({ heading: 'ผลงานที่ผ่านมา',
        body: `${row.name || '[to fill in: project name]'}\n${row.client || '[to fill in: client]'}\nมูลค่า: ${row.value ?? '[to fill in: value]'}\nปี: ${row.year ?? '[to fill in: year]'}\n${row.relevance || ''}`,
        sources: refs(row.sources) });
    // Never silently truncate generator results; the same server limits apply to imports.
    const parsed = parseDraftContent({ sections }, { projectRequired: false });
    if (parsed.code) throw new Error(`Generated draft exceeds editor limits. ${parsed.message}`);
    return parsed.sections;
}
