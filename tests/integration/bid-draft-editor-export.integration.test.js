import { beforeEach, describe, expect, it, vi } from 'vitest';
import yauzl from 'yauzl';
import { signSession } from '@/lib/auth';
import { parseDraftContent, draftPlaceholders, proposalToSections } from '@/lib/bid-prep/draft-content';
import { buildDraftDocx, safeDocxFilename } from '@/lib/bid-prep/docx';

const state = vi.hoisted(() => ({ draft: null }));
vi.mock('@/lib/db', () => ({ default: vi.fn() }));
vi.mock('@/models/Project', () => ({ default: { findOne: () => ({ select: () => ({ lean: async () => ({ project_id: 'TOR-1' }) }) }) } }));
vi.mock('@/models/User', () => ({ User: { findById: () => ({ select: () => ({ lean: async () => ({ company_name: 'Owner company' }) }) }) } }));
vi.mock('@/models/DocumentSummary', () => ({ default: { findOne: () => ({ sort() { return this; }, select() { return this; }, lean: async () => ({ extraction: { qualifications: [{ value: 'มีประสบการณ์พัฒนาระบบ', page: 9 }] } }) }) } }));
vi.mock('@/lib/bid-prep/draft-store', () => ({ createOwnedDraft: vi.fn() }));
vi.mock('@/models/BidPrepDraft', () => ({ BidPrepDraft: {
    findOne: filter => ({ lean: async () => state.draft && state.draft.userId === filter.userId && state.draft._id === filter._id ? structuredClone(state.draft) : null }),
    findOneAndUpdate: (filter, update) => ({ lean: async () => {
        if (!state.draft || state.draft.userId !== filter.userId || state.draft._id !== filter._id || state.draft.version !== filter.version) return null;
        Object.assign(state.draft, update.$set); state.draft.version++; return structuredClone(state.draft);
    } }),
} }));
const { PATCH } = await import('@/app/api/bid-prep/drafts/[id]/route');
const { POST: exportRoute } = await import('@/app/api/bid-prep/drafts/[id]/export/route');
const id = 'a'.repeat(24);
async function call(handler, method, owner, body, suffix = '') {
    const token = owner ? await signSession({ sub: owner, role: 'user' }) : null;
    return handler(new Request(`http://localhost:3000/api/bid-prep/drafts/${id}${suffix}`, { method,
        headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body) }), { params: Promise.resolve({ id }) });
}
function unzip(buffer) {
    return new Promise((resolve, reject) => yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
        if (error) return reject(error);
        const parts = {};
        zip.on('entry', entry => zip.openReadStream(entry, (err, stream) => {
            if (err) return reject(err);
            const chunks = []; stream.on('data', chunk => chunks.push(chunk)); stream.on('error', reject);
            stream.on('end', () => { parts[entry.fileName] = Buffer.concat(chunks).toString('utf8'); zip.readEntry(); });
        }));
        zip.on('end', () => resolve(parts)); zip.on('error', reject); zip.readEntry();
    }));
}
beforeEach(() => { state.draft = { _id: id, userId: 'owner', projectId: 'TOR-1', title: 'ร่างข้อเสนอ', version: 1,
    createdAt: new Date('2026-11-01T00:00:00Z'), updatedAt: new Date('2026-11-15T00:00:00Z'),
    sections: [{ heading: 'ขอบเขต', body: '[to fill in: team]\n=HYPERLINK("bad") <script>literal</script>', sources: ['tor.page.9'] }] }; });

describe('#140/#141 draft limits and export', () => {
    it('rejects oversized and wrong-type fields rather than silently clipping', () => {
        for (const body of [{ title: 'x'.repeat(201) }, { title: false }, { sections: null }, { sections: Array(41).fill({}) },
            { sections: [{ body: 'x'.repeat(8001) }] }, { sections: [{ sources: ['x'.repeat(201)] }] },
            { sections: [{ sources: Array(21).fill('source') }] }, { sections: [{ body: {} }] }]) {
            expect(parseDraftContent(body, { projectRequired: false }).code).toBe('INVALID_DRAFT');
        }
        expect(parseDraftContent({ sections: Array(13).fill({ body: 'x'.repeat(8000) }) }, { projectRequired: false }).status).toBe(413);
    });
    it('imports one sourced generator statement per section without losing references or placeholders', () => {
        const sections = proposalToSections({ company_overview: [{ text: 'บริษัท', sources: [{ kind: 'profile_field', field: 'company_name' }] }],
            project_understanding: [{ text: '[to fill in: plan]', sources: [{ kind: 'tor_page', page: 9 }] }] });
        expect(sections.map(s => s.sources)).toEqual([['profile.company_name'], ['tor.page.9']]);
        expect(draftPlaceholders({ sections })).toEqual(['[to fill in: plan]']);
        expect(draftPlaceholders({ title: '[to fill in]' })).toHaveLength(1);
    });
    it('CAS permits one writer and returns 409 without overwriting another window', async () => {
        const requests = await Promise.all([call(PATCH, 'PATCH', 'owner', { version: 1, title: 'Window A' }), call(PATCH, 'PATCH', 'owner', { version: 1, title: 'Window B' })]);
        expect(requests.map(r => r.status).sort()).toEqual([200, 409]); expect(state.draft.version).toBe(2);
    });
    it('anonymous calls are 401 and foreign mutations/exports are 404 including invalid payloads', async () => {
        expect((await call(PATCH, 'PATCH', null, {})).status).toBe(401);
        expect((await call(exportRoute, 'POST', null)).status).toBe(401);
        expect((await call(PATCH, 'PATCH', 'other', { version: 0 })).status).toBe(404);
        expect((await call(exportRoute, 'POST', 'other')).status).toBe(404);
    });
    it('round trips a valid DOCX with checklist, sources, Thai, notices, dates and highlighted placeholders', async () => {
        const response = await call(exportRoute, 'POST', 'owner'); expect(response.status).toBe(200);
        expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="bid-draft-TOR-1.docx"');
        const files = await unzip(Buffer.from(await response.arrayBuffer()));
        expect(Object.keys(files)).toHaveLength(5);
        const xml = files['word/document.xml'];
        for (const text of ['มีประสบการณ์พัฒนาระบบ', 'manual', 'tor.page.9', '2026-11-01', '2026-11-15', 'does not submit a bid to e-GP', '[to fill in: team]']) expect(xml).toContain(text);
        expect(xml).toContain('<w:tbl>'); expect(xml).toContain('<w:tblHeader/>'); expect(xml).toContain('w:highlight');
        expect(xml).toContain('&lt;script&gt;'); expect(xml).not.toMatch(/<script|<w:instrText|<w:fldChar/);
        expect(files['word/styles.xml']).toContain('Tahoma');
        expect(Object.keys(files).join()).not.toMatch(/vba|macro|html/);
        expect(files['word/_rels/document.xml.rels']).not.toContain('TargetMode="External"');
    });
    it('export checks the saved version and rejects empty or corrupt drafts clearly', async () => {
        expect((await call(exportRoute, 'POST', 'owner', undefined, '?version=2')).status).toBe(409);
        state.draft.sections = [];
        expect((await call(exportRoute, 'POST', 'owner')).status).toBe(400);
        state.draft.sections = [{ body: 'data', heading: 123, sources: [] }];
        expect((await call(exportRoute, 'POST', 'owner')).status).toBe(400);
    });
    it('removes characters forbidden by XML 1.0 before packaging', async () => {
        const parts = await unzip(buildDraftDocx({ title: 'Example', sections: [{ body: 'Thai ข้อมูล\uFFFF\uFFFE', sources: [] }] }));
        expect(parts['word/document.xml']).not.toContain('\uFFFF');
        expect(parts['word/document.xml']).not.toContain('\uFFFE');
        expect(parts['word/document.xml']).toContain('ข้อมูล');
    });
    it('uses safe filenames and plain text even for formula/markup input', async () => {
        expect(safeDocxFilename('../../bad\r\nname')).not.toMatch(/[\/\\\r\n]/);
        const parts = await unzip(buildDraftDocx({ title: 'Example', sections: [{ body: '=1+1', sources: [] }] }));
        expect(parts['word/document.xml']).toContain('&apos;=1+1');
    });
});
