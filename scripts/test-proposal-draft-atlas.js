#!/usr/bin/env node
/**
 * FR-4.3 persistence check against the real MongoDB Atlas cluster.
 * Requires MONGODB_URI in the environment or an uncommitted .env.
 * Refuses mongodb:// and any local or in-memory database.
 * Vertex is stubbed; only the database is live. Fixtures are deleted afterward.
 * Never prints the connection string.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';

const uri = process.env.MONGODB_URI || '';

function redact(value) {
    return String(value ?? '').replace(/mongodb(?:\+srv)?:\/\/\S+/gi, '[redacted-uri]');
}

if (!uri.startsWith('mongodb+srv://')) {
    console.error('Atlas check not run: MONGODB_URI is missing or is not an mongodb+srv:// Atlas URI. No local or mock database was used.');
    process.exit(2);
}

process.env.VERTEX_AI_ENABLED = 'true';
process.env.GOOGLE_CLOUD_PROJECT ||= 'proposal-draft-atlas-check';

const { default: mongoose } = await import('mongoose');
const { connectMongoWithDnsFallback } = await import('../lib/mongo-network.js');
const { User } = await import('../models/User.js');
const { default: Project } = await import('../models/Project.js');
const { default: Document } = await import('../models/Document.js');
const { default: ExtractionRun } = await import('../models/ExtractionRun.js');
const { default: DocumentSummary } = await import('../models/DocumentSummary.js');
const { default: ProcessingJob } = await import('../models/ProcessingJob.js');
const { enqueueProposalDraft } = await import('../lib/job-queue.js');
const { settleProposalDraftJob } = await import('../lib/proposal/job.js');
const { proposalDraftJobFilter, PROPOSAL_DRAFT_WARNING, PROPOSAL_PROMPT_VERSION } = await import('../lib/proposal/draft.js');

const stamp = randomBytes(8).toString('hex');
const projectId = `it-proposal-draft-${stamp}`;
const email = `it-proposal-${stamp}@example.com`;
const companyName = `บริษัททดสอบชั่วคราว ${stamp}`;
const sha = randomBytes(32).toString('hex');
const ids = {
    user: new mongoose.Types.ObjectId(),
    document: new mongoose.Types.ObjectId(),
    run: new mongoose.Types.ObjectId(),
    summary: new mongoose.Types.ObjectId(),
};

function vertexResponse(parsed) {
    return {
        ok: true,
        status: 200,
        json: async () => ({
            modelVersion: 'gemini-2.5-flash-001',
            candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(parsed) }] } }],
        }),
    };
}

const scopeItem = 'พัฒนาระบบทดสอบ';
const modelDraft = {
    company_overview: [{ text: 'บริษัทที่โมเดลแต่งขึ้น ทุน 99999999', sources: [{ kind: 'profile_field', field: 'company_name' }] }],
    project_understanding: [{ text: 'เข้าใจงานทดสอบจากหน้า 2', sources: [{ kind: 'tor_page', page: 2 }] }],
    scope_responses: [{ scope_item: scopeItem, response: 'ดำเนินการตามขอบเขตที่สกัดได้', sources: [{ kind: 'tor_page', page: 2 }] }],
    past_projects: [{ name: 'โครงการที่ไม่มีในโปรไฟล์', sources: [{ kind: 'profile_field', field: 'past_projects' }] }],
};

async function cleanup() {
    await ProcessingJob.deleteMany({ project_id: projectId, type: 'proposal_draft' });
    await DocumentSummary.deleteOne({ _id: ids.summary });
    await ExtractionRun.deleteOne({ _id: ids.run });
    await Document.deleteOne({ _id: ids.document });
    await Project.deleteOne({ project_id: projectId });
    await User.deleteOne({ _id: ids.user });
}

try {
    await connectMongoWithDnsFallback(mongoose, uri);
    console.log(`Connected to Atlas database "${mongoose.connection.name}" without printing the URI.`);

    await User.create({
        _id: ids.user,
        email,
        company_name: companyName,
        skills: ['Node.js'],
        registered_capital: null,
        certifications: [],
    });
    await Document.create({
        _id: ids.document,
        project_id: projectId,
        sha256: sha,
        filename: 'proposal-draft-it.pdf',
        document_type: 'tor',
        is_primary: true,
        is_current_primary: true,
    });
    await ExtractionRun.create({
        _id: ids.run,
        project_id: projectId,
        document_id: ids.document,
        run_key: `proposal-draft-it-${stamp}`,
        processor_fingerprint: 'proposal-draft-it',
        text_sha256: sha,
        page_count: 2,
        status: 'completed',
    });
    await DocumentSummary.create({
        _id: ids.summary,
        project_id: projectId,
        document_id: ids.document,
        extraction_run_id: ids.run,
        document_sha256: sha,
        text_sha256: sha,
        model: 'test-fixture',
        prompt_version: 'test-fixture',
        extraction: {
            summary: 'สรุปเอกสารทดสอบ',
            qualifications: [],
            scope_of_work: [{ value: scopeItem, page: 2 }],
            tech_stack: [],
            flagged_clauses: [],
            risk_findings: [],
        },
    });
    await Project.create({
        project_id: projectId,
        project_name: 'โครงการทดสอบร่างข้อเสนอ',
        dept_name: 'หน่วยงานทดสอบ',
        budget: 1,
        primary_document_id: ids.document,
        latest_extraction_run_id: ids.run,
        latest_summary_id: ids.summary,
    });

    const queued = await enqueueProposalDraft({ projectId, ownerId: String(ids.user) });
    if (queued.reused) throw new Error('A fresh Atlas fixture reused an existing proposal job');
    const stored = await ProcessingJob.findOne(proposalDraftJobFilter({
        projectId, jobId: queued.job._id, ownerId: String(ids.user),
    })).lean();
    if (!stored || stored.status !== 'queued' || stored.type !== 'proposal_draft') {
        throw new Error(`Queued job was not stored for the owner (status ${stored?.status || 'missing'})`);
    }
    const otherOwner = await ProcessingJob.findOne(proposalDraftJobFilter({
        projectId, jobId: queued.job._id, ownerId: new mongoose.Types.ObjectId().toString(),
    })).lean();
    if (otherOwner) throw new Error('Another owner could read the queued proposal job');

    const outcome = await settleProposalDraftJob(stored, {
        headers: async () => ({}),
        writeLog: () => {},
        fetchImpl: async () => vertexResponse(modelDraft),
    });
    if (outcome.status !== 'completed') throw new Error(`Draft did not complete: ${outcome.error || outcome.status}`);

    const finished = await ProcessingJob.findById(stored._id).lean();
    const draft = finished?.result?.draft;
    const rendered = JSON.stringify(finished?.result || {});
    if (finished.status !== 'completed') throw new Error(`Job status remained ${finished.status}`);
    if (draft?.warning !== PROPOSAL_DRAFT_WARNING) throw new Error('Stored draft is missing the AI-draft warning');
    if (draft?.prompt_version !== PROPOSAL_PROMPT_VERSION) throw new Error('Stored draft is missing the prompt version');
    if (!draft?.company_overview?.some(item => item.text.includes(companyName))) {
        throw new Error('Stored draft did not keep the company name loaded from Atlas');
    }
    if (draft?.past_projects?.[0]?.name !== '[to fill in: past_projects]') {
        throw new Error('Missing past projects were not stored as placeholders');
    }
    if (draft?.scope_responses?.[0]?.sources?.[0]?.page !== 2) throw new Error('Scope row lost its TOR page source');
    if (rendered.includes(email) || rendered.includes('99999999') || rendered.includes('โครงการที่ไม่มีในโปรไฟล์')) {
        throw new Error('Stored result contains an email or a fact that was not in the profile');
    }

    const retry = await enqueueProposalDraft({ projectId, ownerId: String(ids.user) });
    const timeoutJob = await ProcessingJob.findById(retry.job._id).lean();
    const timedOut = await settleProposalDraftJob({ ...timeoutJob, attempts: timeoutJob.max_attempts }, {
        headers: async () => ({}),
        writeLog: () => {},
        fetchImpl: async () => {
            const error = new Error('slow');
            error.name = 'TimeoutError';
            throw error;
        },
    });
    const afterTimeout = await ProcessingJob.findById(timeoutJob._id).lean();
    if (timedOut.status !== 'failed' || afterTimeout.status === 'running' || afterTimeout.lease_until) {
        throw new Error(`Timed-out job was left running (status ${afterTimeout.status})`);
    }
    if (!/timed out/i.test(afterTimeout.error || '')) throw new Error('Timed-out job has no clear error');

    console.log(`Atlas proposal-draft check passed for project ${projectId}: queued, completed, isolated by owner, and a timeout did not stay running.`);
} catch (error) {
    console.error(`Atlas proposal-draft check failed: ${redact(error?.message || error)}`);
    process.exitCode = 1;
} finally {
    if (mongoose.connection.readyState) {
        await cleanup().catch(error => console.error(`Atlas fixture cleanup failed: ${redact(error?.message || error)}`));
        await mongoose.disconnect();
    }
}
