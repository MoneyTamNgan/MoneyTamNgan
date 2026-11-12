import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ default: vi.fn(async () => {}) }));
vi.mock('@/lib/project-compat', () => ({ hydrateProjectCompatibility: vi.fn(async project => project) }));
vi.mock('@/lib/job-queue', () => ({ enqueueProposalDraft: vi.fn() }));
vi.mock('@/models/Project', () => ({ default: { findOne: vi.fn() } }));
vi.mock('@/models/ProcessingJob', () => ({ default: { findOne: vi.fn() } }));

const { signSession } = await import('@/lib/auth');
const { POST, GET } = await import('@/app/api/tors/[id]/proposal-draft/route');
const { enqueueProposalDraft } = await import('@/lib/job-queue');
const Project = (await import('@/models/Project')).default;
const ProcessingJob = (await import('@/models/ProcessingJob')).default;
const { resetProposalDraftLimiter } = await import('@/lib/proposal/limit');

const params = Promise.resolve({ id: 'TOR-1' });
const extracted = {
    project_id: 'TOR-1',
    extracted_data: {
        summary: 'สรุปงาน',
        scope_of_work: ['พัฒนาระบบ'],
        qualifications: [],
        tech_stack: [],
        evidence: { scope_of_work: [{ value: 'พัฒนาระบบ', page: 2 }], qualifications: [], tech_stack: [] },
    },
};

async function authed(path, { method = 'POST', sub = 'user-1', body } = {}) {
    const token = await signSession({ sub, role: 'user' });
    return new Request(`http://localhost:3000${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            Origin: 'http://localhost:3000',
            'Content-Type': 'application/json',
        },
        body: method === 'POST' ? JSON.stringify(body ?? { userId: 'someone-else' }) : undefined,
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    process.env.PROPOSAL_DRAFT_LIMIT_PER_HOUR = '5';
    resetProposalDraftLimiter();
    Project.findOne.mockReturnValue({ lean: async () => extracted });
    enqueueProposalDraft.mockResolvedValue({ job: { _id: 'a'.repeat(24), status: 'queued' }, reused: false });
});

it('queues a draft and returns 202 without calling Vertex', async () => {
    const response = await POST(await authed('/api/tors/TOR-1/proposal-draft'), { params });
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toMatchObject({ status: 'accepted', jobStatus: 'queued', reused: false });
    expect(enqueueProposalDraft).toHaveBeenCalledWith({ projectId: 'TOR-1', ownerId: 'user-1' });
    expect(enqueueProposalDraft.mock.calls[0][0].ownerId).not.toBe('someone-else');
});

it('returns 401 when the caller is not signed in', async () => {
    const response = await POST(new Request('http://localhost:3000/api/tors/TOR-1/proposal-draft', {
        method: 'POST', headers: { Origin: 'http://localhost:3000' }, body: '{}',
    }), { params });
    expect(response.status).toBe(401);
    expect(enqueueProposalDraft).not.toHaveBeenCalled();
});

it('returns 429 with Retry-After after the per-user draft limit', async () => {
    process.env.PROPOSAL_DRAFT_LIMIT_PER_HOUR = '1';
    resetProposalDraftLimiter();
    const first = await POST(await authed('/api/tors/TOR-1/proposal-draft'), { params });
    expect(first.status).toBe(202);
    const second = await POST(await authed('/api/tors/TOR-1/proposal-draft'), { params });
    expect(second.status).toBe(429);
    expect(Number(second.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await second.json()).error.code).toBe('PROPOSAL_DRAFT_RATE_LIMITED');
    expect(enqueueProposalDraft).toHaveBeenCalledTimes(1);
});

it('does not reveal another user draft', async () => {
    ProcessingJob.findOne.mockReturnValue({ lean: async () => null });
    const response = await GET(await authed(`/api/tors/TOR-1/proposal-draft?jobId=${'b'.repeat(24)}`, { method: 'GET', sub: 'user-a' }), { params });
    expect(response.status).toBe(404);
    expect(ProcessingJob.findOne).toHaveBeenCalledWith({
        _id: 'b'.repeat(24),
        type: 'proposal_draft',
        project_id: 'TOR-1',
        owner_id: 'user-a',
    });
});

it('returns the sanitized draft, warning, model, and prompt version when the job is done', async () => {
    ProcessingJob.findOne.mockReturnValue({ lean: async () => ({
        _id: 'c'.repeat(24),
        status: 'completed',
        result: {
            model: 'gemini-2.5-flash',
            prompt_version: 'proposal-draft-v1',
            draft: {
                warning: 'replaced by the server',
                model: 'gemini-2.5-flash',
                model_version: 'gemini-2.5-flash-001',
                prompt_version: 'proposal-draft-v1',
                company_overview: [{ text: 'company_name: บริษัททดสอบ', sources: [{ kind: 'profile_field', field: 'company_name' }] }],
                project_understanding: [{ text: 'เข้าใจงาน<script>alert(1)</script>', sources: [{ kind: 'tor_page', page: 2 }] }],
                scope_responses: [],
                past_projects: [],
            },
        },
    }) });
    const response = await GET(await authed(`/api/tors/TOR-1/proposal-draft?jobId=${'c'.repeat(24)}`, { method: 'GET' }), { params });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.warning).toMatch(/AI draft/);
    expect(body.model).toBe('gemini-2.5-flash');
    expect(body.prompt_version).toBe('proposal-draft-v1');
    expect(body.draft.project_understanding[0].text).toBe('เข้าใจงาน');
    expect(JSON.stringify(body)).not.toContain('<script');
});
