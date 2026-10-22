import { beforeEach, expect, it, vi } from 'vitest';

process.env.PIPELINE_ADMIN_TOKEN = 't'.repeat(32);

const state = vi.hoisted(() => ({ project: null, document: null, candidate: null, audits: [], jobs: [] }));
const lean = value => ({ lean: async () => (value ? structuredClone(value) : value) });
const applySet = (target, set) => {
    for (const [path, value] of Object.entries(set)) {
        const keys = path.split('.');
        let node = target;
        for (const key of keys.slice(0, -1)) node = node[key] ??= {};
        node[keys.at(-1)] = value;
    }
};

vi.mock('@/lib/db', () => ({ default: vi.fn() }));
vi.mock('@/lib/project-compat', () => ({ hydrateProjectCompatibility: async project => project }));
vi.mock('@/lib/job-queue', () => ({ enqueueProject: vi.fn(async (...args) => { state.jobs.push(args); return { reused: false }; }) }));
vi.mock('@/models/Project', () => {
    const model = {
        schema: { path: () => ({ enumValues: ['document_pending', 'document_downloaded', 'irrelevant', 'review_required', 'completed'] }) },
        findOne: vi.fn(() => lean(state.project)),
        findById: vi.fn(() => lean(state.project)),
        updateOne: vi.fn(async (_filter, update) => applySet(state.project, update.$set)),
    };
    return { default: model };
});
vi.mock('@/models/Document', () => ({ default: {
    schema: { path: () => ({ enumValues: ['stored', 'review_required', 'failed'] }) },
    findById: vi.fn(() => lean(state.document)),
    updateOne: vi.fn(async (_filter, update) => applySet(state.document, update.$set)),
} }));
vi.mock('@/models/DiscoveryCandidate', () => ({ default: {
    findOne: vi.fn(() => lean(state.candidate)),
    findById: vi.fn(() => lean(state.candidate)),
    updateOne: vi.fn(async (_filter, update) => Object.assign(state.candidate, update.$set)),
} }));
vi.mock('@/models/ClassificationOverride', () => ({ default: {
    create: vi.fn(async doc => { state.audits.push(doc); return doc; }),
    find: vi.fn(() => ({ sort: () => ({ limit: () => lean(state.audits.map((entry, index) => ({ _id: `a${index}`, created_at: new Date(0), ...entry }))) }) })),
} }));

const { PATCH, GET } = await import('@/app/api/admin/tors/[id]/classification/route');
const { signSession } = await import('@/lib/auth');

beforeEach(() => {
    state.project = {
        _id: 'p1', project_id: '69000000001', project_name: 'จ้างซ่อมแซมระบบ', dept_name: 'BMA',
        is_software: null, primary_document_id: 'd1',
        classification: { status: 'uncertain', confidence: 0.4 },
        processing: { status: 'review_required' },
    };
    state.document = { _id: 'd1', processing_status: 'stored' };
    state.candidate = null;
    state.audits = [];
    state.jobs = [];
});

async function adminCookie() {
    return `mtn_session=${await signSession({ sub: 'admin-123', email: 'admin@example.com', role: 'admin' })}`;
}

async function patch(body, headers = {}, id = '69000000001') {
    return PATCH(new Request(`http://localhost/api/admin/tors/${id}/classification`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
    }), { params: Promise.resolve({ id }) });
}

it('reclassifies a low-confidence TOR as software, assigns tags and logs the reviewer', async () => {
    const response = await patch({ isSoftware: true, tags: ['ERP', ' erp ', 'Cloud'], reason: 'TOR scope is an ERP system' }, { cookie: await adminCookie() });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.classification).toMatchObject({
        isSoftware: true, status: 'manual_override', confidence: null, reason: 'TOR scope is an ERP system',
        tags: ['ERP', 'Cloud'], reviewedBy: { userId: 'admin-123', email: 'admin@example.com', via: 'admin_session' },
    });
    expect(body.classification.reviewedAt).toBeTruthy();
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({
        project_id: '69000000001', target: 'project',
        reviewer: { user_id: 'admin-123', via: 'admin_session' },
        before: { is_software: null, classification_status: 'uncertain' },
        after: { is_software: true, classification_status: 'manual_override', tags: ['ERP', 'Cloud'] },
    });
});

it('marks not-software TORs irrelevant and overrides the document status', async () => {
    await patch({ isSoftware: false, documentStatus: 'review_required' }, { cookie: await adminCookie() });
    expect(state.project.is_software).toBe(false);
    expect(state.project.processing.status).toBe('irrelevant');
    expect(state.document.processing_status).toBe('review_required');
    expect(state.audits[0].after.document_status).toBe('review_required');
});

it('brings an irrelevant TOR back into the pipeline when reclassified as software', async () => {
    state.project.processing.status = 'irrelevant';
    state.project.primary_document_id = null;
    await patch({ isSoftware: true, enqueueProcessing: true }, { cookie: await adminCookie() });
    expect(state.project.processing.status).toBe('document_pending');
    expect(state.jobs).toEqual([['69000000001']]);
});

it('records pipeline-token callers as such', async () => {
    await patch({ tags: ['GIS'] }, { authorization: `Bearer ${process.env.PIPELINE_ADMIN_TOKEN}` });
    expect(state.audits[0].reviewer).toEqual({ user_id: null, email: null, via: 'pipeline_token' });
    expect(state.project.classification.status).toBe('uncertain');
});

it('rejects requests without an admin reviewer', async () => {
    const response = await patch({ isSoftware: true });
    expect(response.status).toBe(401);
    expect(state.audits).toHaveLength(0);
});

it('validates the body', async () => {
    const cookie = await adminCookie();
    for (const body of [{}, { isSoftware: 'yes' }, { tags: [''] }, { documentStatus: 'bogus' }, { reason: 'only a reason' }]) {
        expect((await patch(body, { cookie })).status).toBe(400);
    }
});

it('returns 409 for a document status override without a stored document', async () => {
    state.project.primary_document_id = null;
    const response = await patch({ documentStatus: 'failed' }, { cookie: await adminCookie() });
    expect(response.status).toBe(409);
});

it('overrides an unpublished discovery candidate and queues its verification', async () => {
    state.project = null;
    state.candidate = { _id: 'c1', project_id: '69000000002', status: 'review_required', classification: { isSoftware: null, status: 'uncertain' } };
    const response = await patch({ isSoftware: true }, { cookie: await adminCookie() }, '69000000002');
    const body = await response.json();
    expect(body).toMatchObject({ target: 'candidate', status: 'pending', classification: { isSoftware: true, status: 'manual_override' } });
    expect(state.jobs).toEqual([['69000000002', { type: 'verify_candidate' }]]);
    expect(state.audits[0].target).toBe('candidate');
});

it('returns 404 for unknown ids', async () => {
    state.project = null;
    expect((await patch({ isSoftware: true }, { cookie: await adminCookie() })).status).toBe(404);
});

it('lists the override history with the reviewer', async () => {
    await patch({ isSoftware: true }, { cookie: await adminCookie() });
    const response = await GET(new Request('http://localhost/api/admin/tors/69000000001/classification'), { params: Promise.resolve({ id: '69000000001' }) });
    const { items } = await response.json();
    expect(items[0].reviewer).toEqual({ userId: 'admin-123', email: 'admin@example.com', via: 'admin_session' });
});
