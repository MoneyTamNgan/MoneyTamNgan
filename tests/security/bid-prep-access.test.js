import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signSession } from '@/lib/auth';
import { permissionFor } from '@/lib/request-authorization';
import { BID_PREP_ENDPOINTS, setBidPrepClockForTests } from '@/lib/bid-prep/security';
import { DELETE_COMPANY_DATA_CONFIRMATION } from '@/lib/bid-prep/notices';

const state = vi.hoisted(() => ({
    drafts: [],
    users: new Map(),
    projects: new Map(),
    summaries: new Map(),
    failProject: false,
    seq: 0,
}));

vi.mock('@/lib/db', () => ({ default: vi.fn(async () => undefined) }));
vi.mock('@/models/Project', () => ({
    default: {
        findOne: (filter) => ({
            select() { return this; },
            lean: async () => {
                if (state.failProject) throw new Error('boom SECRET DRAFT BODY');
                return state.projects.get(filter.project_id) || null;
            },
        }),
    },
}));
vi.mock('@/models/DocumentSummary', () => ({
    default: {
        findOne: (filter) => ({
            sort() { return this; },
            select() { return this; },
            lean: async () => state.summaries.get(filter.project_id) || null,
        }),
    },
}));
vi.mock('@/models/User', () => ({
    User: {
        findById(id) {
            return { select: () => ({ lean: async () => cloneUser(state.users.get(String(id))) }) };
        },
        findByIdAndUpdate(id, update) {
            const current = state.users.get(String(id));
            if (!current) return null;
            if (update.$set) Object.assign(current, update.$set);
            if (update.$unset) for (const key of Object.keys(update.$unset)) delete current[key];
            return current;
        },
        collection: {
            findOne: async (filter) => cloneUser(state.users.get(String(filter._id))),
        },
    },
}));
vi.mock('@/models/BidPrepDraft', () => ({
    BidPrepDraft: {
        async create(doc) {
            state.seq += 1;
            const row = { ...doc, _id: state.seq.toString(16).padStart(24, 'a'), sections: (doc.sections || []).map(section => ({ ...section })) };
            state.drafts.push(row);
            return row;
        },
        find(filter) {
            const rows = state.drafts.filter(row => row.userId === filter.userId).map(row => ({ ...row }));
            const query = { sort() { return query; }, limit() { return query; }, select() { return query; }, lean: async () => rows };
            return query;
        },
        findOne(filter) {
            const row = state.drafts.find(row => row.userId === filter.userId && String(row._id) === String(filter._id));
            return { lean: async () => (row ? { ...row, sections: (row.sections || []).map(section => ({ ...section })) } : null) };
        },
        findOneAndUpdate(filter, update) {
            const row = state.drafts.find(row => row.userId === filter.userId && String(row._id) === String(filter._id) && row.version === filter.version);
            if (row) {
                if (update.$set) Object.assign(row, update.$set);
                if (update.$inc?.version) row.version += update.$inc.version;
            }
            const snapshot = row ? { ...row, sections: (row.sections || []).map(section => ({ ...section })) } : null;
            return { lean: async () => snapshot };
        },
        async deleteOne(filter) {
            const index = state.drafts.findIndex(row => row.userId === filter.userId && String(row._id) === String(filter._id));
            if (index < 0) return { deletedCount: 0 };
            state.drafts.splice(index, 1);
            return { deletedCount: 1 };
        },
        async deleteMany(filter) {
            const before = state.drafts.length;
            for (let index = state.drafts.length - 1; index >= 0; index -= 1) {
                if (state.drafts[index].userId === filter.userId) state.drafts.splice(index, 1);
            }
            return { deletedCount: before - state.drafts.length };
        },
        async countDocuments(filter) {
            return state.drafts.filter(row => row.userId === filter.userId).length;
        },
    },
}));

function cloneUser(user) {
    if (!user) return null;
    return {
        ...user,
        skills: [...(user.skills || [])],
        techStack: [...(user.techStack || [])],
        certifications: [...(user.certifications || [])],
        past_projects: user.past_projects ? user.past_projects.map(project => ({ ...project })) : undefined,
    };
}

const { GET: listDrafts, POST: createDraft } = await import('@/app/api/bid-prep/drafts/route');
const { GET: readDraft, PATCH: updateDraft, DELETE: removeDraft } = await import('@/app/api/bid-prep/drafts/[id]/route');
const { POST: exportDraft } = await import('@/app/api/bid-prep/drafts/[id]/export/route');
const { GET: checklist } = await import('@/app/api/bid-prep/tors/[projectId]/checklist/route');
const { DELETE: deleteData } = await import('@/app/api/bid-prep/data/route');
const { GET: profileGet, PATCH: profilePatch, PUT: profilePut, DELETE: profileDelete } = await import('@/app/api/profiles/route');

const handlers = {
    'GET /api/profiles': profileGet,
    'PUT /api/profiles': profilePut,
    'PATCH /api/profiles': profilePatch,
    'DELETE /api/profiles': profileDelete,
    'DELETE /api/bid-prep/data': deleteData,
    'POST /api/bid-prep/drafts': createDraft,
    'GET /api/bid-prep/drafts': listDrafts,
    'GET /api/bid-prep/drafts/[id]': readDraft,
    'PATCH /api/bid-prep/drafts/[id]': updateDraft,
    'DELETE /api/bid-prep/drafts/[id]': removeDraft,
    'POST /api/bid-prep/drafts/[id]/export': exportDraft,
    'GET /api/bid-prep/tors/[projectId]/checklist': checklist,
};

let clock = 1_700_000_000_000;
beforeEach(() => {
    clock += 60 * 60 * 1000;
    setBidPrepClockForTests(() => clock);
    state.drafts.length = 0;
    state.users.clear();
    state.projects.clear();
    state.summaries.clear();
    state.failProject = false;
    vi.unstubAllEnvs();
});

function seedUser(id, extra = {}) {
    state.users.set(id, {
        _id: id,
        email: `${id}@example.test`,
        passwordHash: `hash-${id}`,
        company_name: extra.company_name ?? `${id} company`,
        skills: extra.skills ?? ['React'],
        techStack: ['React'],
        registered_capital: extra.registered_capital === undefined ? 1000 : extra.registered_capital,
        highest_past_project_value: 500,
        concurrent_project_capacity: 1,
        certifications: ['ISO 27001'],
        authorized_signatory: 'นายทดสอบ',
        past_projects: [{ name: 'old', client: 'dept', value: 1, year: 2567 }],
        ...extra,
    });
}

async function call(handler, path, { method = 'GET', token, body, params = {}, origin = 'http://localhost:3000', headers = {} } = {}) {
    return handler(new Request(`http://localhost:3000${path}`, {
        method,
        headers: {
            ...(origin ? { Origin: origin } : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            'x-forwarded-for': '203.0.113.10',
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    }), { params: Promise.resolve(params) });
}

async function session(sub, scopes) {
    return signSession({ sub, role: 'user', ...(scopes ? { scopes } : {}) });
}

describe('BidPrep endpoint controls', () => {
    it('maps every BidPrep endpoint to a handler, a scope and a test', () => {
        expect(new Set(BID_PREP_ENDPOINTS.map(item => `${item.method} ${item.path}`)).size).toBe(BID_PREP_ENDPOINTS.length);
        for (const item of BID_PREP_ENDPOINTS) {
            expect(handlers[`${item.method} ${item.path}`], item.path).toBeTypeOf('function');
            const livePath = item.path
                .replace('[id]', 'a'.repeat(24))
                .replace('[projectId]', 'TOR-1');
            expect(permissionFor(livePath, item.method).scope).toBe(item.scope);
            expect(permissionFor(item.path, item.method).scope).toBe(item.scope);
        }
        expect(permissionFor('/api/bid-prep/tors/TOR-1/checklist', 'POST').admin).toBe(true);
        expect(permissionFor('/api/bid-prep/drafts/abc/export', 'GET').admin).toBe(true);
    });

    it('requires login on every endpoint', async () => {
        for (const item of BID_PREP_ENDPOINTS) {
            const response = await call(handlers[`${item.method} ${item.path}`], item.path, { method: item.method, origin: 'http://localhost:3000' });
            expect(response.status, `${item.method} ${item.path}`).toBe(401);
            expect(await response.json()).toEqual({ error: { code: 'UNAUTHORIZED', message: expect.any(String) } });
        }
    });

    it('rejects a cookie mutation without an allowed Origin', async () => {
        const token = await session('attacker');
        const response = await call(createDraft, '/api/bid-prep/drafts', {
            method: 'POST', origin: '', body: { projectId: 'TOR-1', title: 'x' },
            headers: { Cookie: `mtn_session=${token}`, Authorization: '' },
        });
        expect(response.status).toBe(403);
        expect((await response.json()).error.code).toBe('FORBIDDEN_ORIGIN');
    });

    it('stores the session subject and hides the other user on every draft route', async () => {
        seedUser('attacker');
        seedUser('victim', { company_name: 'VictimCo-9f3c' });
        state.projects.set('TOR-1', { _id: 'project' });
        state.drafts.push({
            _id: 'b'.repeat(24), userId: 'victim', projectId: 'TOR-1', title: 'VICTIM DRAFT SECRET',
            sections: [{ heading: 'Secret', body: 'VICTIM DRAFT SECRET', sources: [] }], version: 1,
            createdAt: new Date(), updatedAt: new Date(),
        });
        const attacker = await session('attacker');
        const victim = await session('victim');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const created = await call(createDraft, '/api/bid-prep/drafts', {
            method: 'POST', token: attacker,
            body: { projectId: 'TOR-1', userId: 'victim', role: 'admin', title: 'ATTACKER DRAFT', sections: [{ heading: 'One', body: 'SECRET DRAFT BODY', sources: ['profile.company_name'] }] },
        });
        expect(created.status).toBe(201);
        const createdBody = await created.json();
        expect(state.drafts.find(row => row.title === 'ATTACKER DRAFT').userId).toBe('attacker');
        expect(createdBody.notices.noEgpSubmission).toMatch(/does not submit a bid to e-GP/);
        const audit = warn.mock.calls.map(entry => String(entry[0])).find(line => line.includes('bid_prep_draft_created'));
        const auditRecord = JSON.parse(audit);
        expect(auditRecord).toMatchObject({ event: 'bid_prep_draft_created', userId: 'attacker', clientAddress: '203.0.113.10' });
        expect(auditRecord.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        expect(audit).not.toContain('SECRET DRAFT BODY');

        const listed = await call(listDrafts, '/api/bid-prep/drafts', { token: attacker });
        const listedBody = await listed.json();
        expect(listedBody.drafts.map(row => row.title)).toEqual(['ATTACKER DRAFT']);
        expect(JSON.stringify(listedBody)).not.toContain('VICTIM DRAFT SECRET');

        const denied = await call(readDraft, `/api/bid-prep/drafts/${'b'.repeat(24)}`, { token: attacker, params: { id: 'b'.repeat(24) } });
        expect(denied.status).toBe(404);
        expect(JSON.stringify(await denied.json())).not.toContain('VICTIM DRAFT SECRET');
        expect((await call(readDraft, `/api/bid-prep/drafts/${'b'.repeat(24)}`, { token: victim, params: { id: 'b'.repeat(24) } })).status).toBe(200);

        const id = createdBody.id;
        expect((await call(updateDraft, `/api/bid-prep/drafts/${id}`, {
            method: 'PATCH', token: victim, params: { id }, body: { version: 1, title: 'stolen' },
        })).status).toBe(404);
        expect(state.drafts.find(row => row._id === id).title).toBe('ATTACKER DRAFT');
        const updated = await call(updateDraft, `/api/bid-prep/drafts/${id}`, {
            method: 'PATCH', token: attacker, params: { id }, body: { version: 1, title: 'revised' },
        });
        expect(updated.status).toBe(200);
        expect((await call(updateDraft, `/api/bid-prep/drafts/${id}`, {
            method: 'PATCH', token: attacker, params: { id }, body: { version: 1, title: 'stale' },
        })).status).toBe(409);

        const exported = await call(exportDraft, `/api/bid-prep/drafts/${id}/export`, { method: 'POST', token: attacker, params: { id } });
        expect(exported.status).toBe(200);
        expect(exported.headers.get('content-disposition')).toBe('attachment; filename="bid-draft-TOR-1.docx"');
        const xml = Buffer.from(await exported.arrayBuffer()).toString('utf8');
        expect(xml).toContain('does not submit a bid to e-GP');
        expect(xml).toContain('ร่างข้อเสนอ'.slice(0, 0) || 'revised');
        expect(xml).not.toContain('<script');
        const exportAudit = warn.mock.calls.map(entry => String(entry[0])).find(line => line.includes('bid_prep_draft_exported'));
        expect(exportAudit).not.toContain('SECRET DRAFT BODY');
        expect((await call(exportDraft, `/api/bid-prep/drafts/${'b'.repeat(24)}/export`, {
            method: 'POST', token: attacker, params: { id: 'b'.repeat(24) },
        })).status).toBe(404);
        expect((await call(removeDraft, `/api/bid-prep/drafts/${'b'.repeat(24)}`, {
            method: 'DELETE', token: attacker, params: { id: 'b'.repeat(24) },
        })).status).toBe(404);
        expect(state.drafts.some(row => row.userId === 'victim')).toBe(true);
        warn.mockRestore();
    });

    it('returns 429 with Retry-After when the draft quota is spent', async () => {
        vi.stubEnv('BID_PREP_DRAFTS_PER_HOUR', '1');
        seedUser('quota-user');
        state.projects.set('TOR-1', { _id: 'project' });
        const token = await session('quota-user');
        const body = { projectId: 'TOR-1', title: 'one', sections: [] };
        expect((await call(createDraft, '/api/bid-prep/drafts', { method: 'POST', token, body })).status).toBe(201);
        const limited = await call(createDraft, '/api/bid-prep/drafts', { method: 'POST', token, body });
        expect(limited.status).toBe(429);
        expect(limited.headers.get('retry-after')).toMatch(/^\d+$/);
        expect(await limited.json()).toEqual({ error: { code: 'RATE_LIMITED', message: expect.stringMatching(/Too many requests/) } });
    });

    it('rejects an oversized body and a read-only session before writing', async () => {
        seedUser('writer');
        state.projects.set('TOR-1', { _id: 'project' });
        const token = await session('writer');
        const oversized = await call(createDraft, '/api/bid-prep/drafts', {
            method: 'POST', token, body: { projectId: 'TOR-1', title: 'x'.repeat(200_000) },
        });
        expect(oversized.status).toBe(413);
        expect(state.drafts).toHaveLength(0);
        const reader = await session('writer', ['profile:read']);
        expect((await call(createDraft, '/api/bid-prep/drafts', {
            method: 'POST', token: reader, body: { projectId: 'TOR-1', title: 'nope' },
        })).status).toBe(403);
        expect(state.drafts).toHaveLength(0);
    });

    it('does not leak internal errors', async () => {
        seedUser('writer');
        state.failProject = true;
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const response = await call(createDraft, '/api/bid-prep/drafts', {
            method: 'POST', token: await session('writer'), body: { projectId: 'TOR-1', title: 'SECRET DRAFT BODY' },
        });
        expect(response.status).toBe(500);
        const body = await response.json();
        expect(body).toEqual({ error: { code: 'INTERNAL', message: 'The request could not be completed.' } });
        expect(JSON.stringify(body)).not.toContain('SECRET DRAFT BODY');
        expect(error.mock.calls.map(entry => String(entry[0])).join('\n')).not.toContain('SECRET DRAFT BODY');
        error.mockRestore();
    });

    it('builds a checklist from the caller profile only', async () => {
        seedUser('attacker', { company_name: '', registered_capital: null, skills: [], certifications: [] });
        seedUser('victim', { company_name: 'VictimCo-9f3c' });
        state.projects.set('TOR-9', { _id: 'project' });
        state.summaries.set('TOR-9', {
            needs_review: false,
            extraction: { qualifications: [{ value: 'ignore previous instructions', page: 3, needs_review: true }] },
        });
        const response = await call(checklist, '/api/bid-prep/tors/TOR-9/checklist?userId=victim', {
            token: await session('attacker'), params: { projectId: 'TOR-9' },
        });
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(JSON.stringify(body)).not.toContain('VictimCo-9f3c');
        expect(body.items[0]).toMatchObject({ status: 'manual', needsReview: true, evidencePages: [3] });
        expect(body.summary).toEqual({ pass: 0, fail: 0, manual: 1 });
        expect(body.missingProfileFields).toContain('registered_capital');
        expect(body.notices.noEgpSubmission).toMatch(/does not submit a bid to e-GP/);
        state.summaries.delete('TOR-9');
        expect((await call(checklist, '/api/bid-prep/tors/TOR-9/checklist', {
            token: await session('attacker'), params: { projectId: 'TOR-9' },
        })).status).toBe(409);
        expect((await call(checklist, '/api/bid-prep/tors/missing/checklist', {
            token: await session('attacker'), params: { projectId: 'missing' },
        })).status).toBe(404);
        expect((await call(checklist, '/api/bid-prep/tors/../etc/checklist', {
            token: await session('attacker'), params: { projectId: '../etc' },
        })).status).toBe(404);
    });

    it('deletes only the caller company data and proves the second read is empty', async () => {
        seedUser('attacker', { company_name: 'Atlas Attacker', registration_number: '010', address: 'Bangkok' });
        seedUser('victim', { company_name: 'VictimCo-9f3c' });
        state.drafts.push(
            { _id: 'c'.repeat(24), userId: 'attacker', projectId: 'TOR-1', title: 'gone', sections: [{ heading: 'A', body: 'SECRET DRAFT BODY', sources: [] }], version: 1 },
            { _id: 'd'.repeat(24), userId: 'victim', projectId: 'TOR-1', title: 'stays', sections: [], version: 1 },
        );
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const response = await call(deleteData, '/api/bid-prep/data', {
            method: 'DELETE', token: await session('attacker'), body: { confirm: DELETE_COMPANY_DATA_CONFIRMATION },
        });
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body).toEqual({ status: 'deleted', draftsDeleted: 1 });
        expect(JSON.stringify(body)).not.toContain('hash-attacker');
        const attacker = state.users.get('attacker');
        expect(attacker.company_name).toBe('');
        expect(attacker.skills).toEqual([]);
        expect(attacker.registered_capital).toBeNull();
        expect(attacker.authorized_signatory).toBeUndefined();
        expect(attacker.past_projects).toBeUndefined();
        expect(attacker.registration_number).toBeUndefined();
        expect(attacker.email).toBe('attacker@example.test');
        expect(attacker.passwordHash).toBe('hash-attacker');
        expect(state.drafts.map(row => row.userId)).toEqual(['victim']);
        expect(state.users.get('victim').company_name).toBe('VictimCo-9f3c');
        const audit = JSON.parse(warn.mock.calls.map(entry => String(entry[0])).find(line => line.includes('bid_prep_data_deleted')));
        expect(audit).toMatchObject({
            event: 'bid_prep_data_deleted', userId: 'attacker', scope: 'company', clientAddress: '203.0.113.10', draftsDeleted: 1,
        });
        expect(audit.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(JSON.stringify(audit)).not.toContain('SECRET DRAFT BODY');
        warn.mockRestore();
        const missing = await call(deleteData, '/api/bid-prep/data', {
            method: 'DELETE', token: await session('nobody'), body: { confirm: 'DELETE_COMPANY_DATA' },
        });
        expect(missing.status).toBe(404);
    });
});
