import { readFile } from 'node:fs/promises';
import connectDB from '../db.js';
import Project from '../../models/Project.js';
import { collectOpenTenders, tenderStatus } from '../egp-rss.js';
import { classifyProjectMetadata } from '../classifier.js';
import { loadKeywordSets } from '../keywords.js';
import {
    acquireTenderDocuments,
    closeAcquisitionContext,
    createAcquisitionContext,
} from '../tender-acquisition.js';
import {
    hashFile,
    persistDocument,
    removeTransientDocuments,
} from '../document-storage.js';
import {
    persistAnnouncementRecord,
    persistPdfBundle,
} from '../mongo-artifacts.js';
import {
    announcementProcurementEligibility,
    announcementScheduleFields,
    SCHEDULE_VERSION,
} from '../announcement-schedule.js';
import { processProject } from '../processing-pipeline.js';
import { notifyUsersOfMatchingTors } from './notification-service.js';

function inferFiscalYear(projectId) {
    const match = String(projectId).match(/^(\d{2})/);
    return match ? String(2500 + Number(match[1])) : 'unknown';
}

async function defaultDepartmentIds() {
    try {
        const url = new URL('../egp-rss-depts.json', import.meta.url);
        const data = await readFile(url, 'utf8');
        return JSON.parse(data);
    } catch {
        return ['1507', '2102', '0703', '0804', '0806'];
    }
}

async function upsertTenderProject(tender) {
    const published = tender.pubDate ? new Date(`${tender.pubDate}T00:00:00+07:00`) : undefined;
    await Project.updateOne({ project_id: tender.projectId }, {
        $set: {
            'tender.rss_dept_id': tender.deptId,
            'tender.method': tender.method || undefined,
            'tender.draft_url': tender.draftLink || undefined,
            'tender.invitation_url': tender.invitationLink || undefined,
            'tender.published_at': published,
        },
        $setOnInsert: {
            project_id: tender.projectId,
            project_name: tender.title,
            'timeline.announce_date': published,
            'source.provider': 'egp_rss',
            'source.fetched_at': new Date(),
            is_software: null,
            'classification.status': 'pending',
            'processing.status': 'metadata_ingested',
            'processing.attempts': 0,
            'workflow.status': 'metadata_ingested',
            'anomalies.high_budget_flag': false,
            'anomalies.budget_deviation_multiplier': 1,
        },
    }, { upsert: true });
    return Project.findOne({ project_id: tender.projectId }).lean();
}

async function classifyTender(project, keywordSets) {
    if (project.classification?.status === 'manual_override') {
        return { isSoftware: project.is_software, status: 'manual_override' };
    }
    const classification = classifyProjectMetadata(project, keywordSets);
    await Project.updateOne({ _id: project._id }, {
        $set: {
            is_software: classification.isSoftware,
            classification: {
                status: classification.status,
                confidence: classification.confidence,
                method: classification.method,
                classified_at: new Date(),
                reason: classification.reason,
            },
            ...(classification.isSoftware === false && !project.primary_document_id
                ? { 'processing.status': 'irrelevant' }
                : {}),
        },
    });
    return classification;
}

export async function persistDocuments(project, tender, outcome, announcementStorage = 'remote') {
    const fiscalYear = inferFiscalYear(project.project_id);
    const set = {};
    let announcementDocument = null;
    let torDocument = null;

    if (outcome.announcement) {
        const persisted = announcementStorage === 'remote'
            ? { ...await hashFile(outcome.announcement.path), backend: 'remote' }
            : await persistDocument({
                projectId: project.project_id,
                fiscalYear,
                localPath: outcome.announcement.path,
                mimeType: 'application/pdf',
                backend: announcementStorage,
            });
        announcementDocument = await persistAnnouncementRecord(project, outcome.announcement, persisted);
        set.announcement_document_id = announcementDocument._id;
        Object.assign(set, announcementScheduleFields(outcome.announcement.schedule, {
            documentId: announcementDocument._id,
            sourceUrl: outcome.announcement.url,
            method: outcome.announcement.extractionMethod,
            error: outcome.announcement.extractionError,
        }));

        const { agency, referencePrice, submission } = outcome.announcement.invitation || {};
        if (submission) {
            set['tender.submission_date'] = submission.date;
            set['tender.submission_start_time'] = submission.startTime;
            set['tender.submission_end_time'] = submission.endTime;
            set['tender.closes_at'] = submission.closesAt ? new Date(submission.closesAt) : null;
        }
        if (referencePrice) set['tender.reference_price'] = referencePrice;
        if (project.source?.provider === 'egp_rss') {
            if (agency && !project.dept_name) set.dept_name = agency;
            if (referencePrice && !project.budget) set.budget = referencePrice;
        }
    }

    if (outcome.tor) {
        const persisted = process.env.TOR_RETAIN_SOURCE_FILES !== 'true'
            ? { ...await hashFile(outcome.tor.pdf_path), backend: 'remote' }
            : await persistDocument({
                projectId: project.project_id,
                fiscalYear,
                localPath: outcome.tor.pdf_path,
                mimeType: outcome.tor.pdf_content_type,
            });
        torDocument = await persistPdfBundle(
            project,
            outcome.tor,
            persisted,
            outcome.tor.resolver_source || 'egp_browser'
        );
        Object.assign(set, {
            primary_document_id: torDocument._id,
            'tender.tor_route': outcome.torRoute,
            'processing.status': 'document_downloaded',
            'processing.error_code': null,
            'processing.error': null,
            'workflow.status': 'document_downloaded',
            'workflow.error': null,
            'workflow.updated_at': new Date(),
        });
    }

    const closesAt = outcome.announcement
        ? outcome.announcement.invitation?.submission?.closesAt
        : project.tender?.closes_at;

    Object.assign(set, {
        'tender.status': tenderStatus({
            hasDraft: Boolean(tender.draftLink),
            hasInvitation: Boolean(tender.invitationLink),
            closesAt,
        }),
        'tender.checked_at': new Date(),
        'tender.error': [
            outcome.torError && `TOR: ${outcome.torError}`,
            outcome.announcementError && `announcement: ${outcome.announcementError}`,
        ].filter(Boolean).join('; ').slice(0, 1000) || null,
    });

    if (!outcome.tor && !project.primary_document_id) {
        set['processing.status'] = outcome.torDeferred
            ? (outcome.eligibility?.status === 'closed' ? 'metadata_only' : 'review_required')
            : 'retry_pending';
        if (outcome.torDeferred) set['workflow.status'] = `procurement_${outcome.eligibility?.status}`;
        set['processing.error'] = outcome.torError;
    }

    if (outcome.eligibility) set.procurement_eligibility = outcome.eligibility;
    const update = { $set: Object.fromEntries(Object.entries(set).filter(([, value]) => value !== undefined)) };
    if (!outcome.tor) update.$inc = { 'processing.download_attempts': 1 };
    await Project.updateOne({ _id: project._id }, update);

    return { torDocument, announcementDocument };
}

// In-memory state tracking for active and recent pipeline runs
const initialRunState = () => ({
    id: null,
    status: 'idle', // 'idle' | 'running' | 'completed' | 'failed'
    phase: 'idle',  // 'discovery' | 'acquisition' | 'processing' | 'notification' | 'completed' | 'failed'
    startedAt: null,
    completedAt: null,
    progress: {
        current: 0,
        total: 0,
        percent: 0,
        stage: 'idle',
        message: 'ระบบพร้อมสำหรับการทำงาน',
    },
    summary: {
        discovered: 0,
        candidates: 0,
        documentsAcquired: 0,
        processed: 0,
        notified: 0,
        errors: [],
    },
    error: null,
});

let currentRun = initialRunState();

export function getStatus() {
    return { ...currentRun, progress: { ...currentRun.progress }, summary: { ...currentRun.summary, errors: [...currentRun.summary.errors] } };
}

export function resetStatus() {
    currentRun = initialRunState();
    return getStatus();
}

function updateProgress(patch) {
    if (patch.phase) currentRun.phase = patch.phase;
    if (patch.status) currentRun.status = patch.status;
    if (patch.progress) currentRun.progress = { ...currentRun.progress, ...patch.progress };
    if (patch.summary) currentRun.summary = { ...currentRun.summary, ...patch.summary };
    if (patch.error !== undefined) currentRun.error = patch.error;
    if (patch.completedAt) currentRun.completedAt = patch.completedAt;
}

/**
 * Executes the full end-to-end data pipeline:
 * 1. Discovery & Ingestion: pulls tenders from e-GP RSS and filters software candidates.
 * 2. Document Acquisition: downloads both TOR & Announcement PDFs (Hybrid P5 approach).
 * 3. Processing: runs OCR, Vertex AI summarization, budget anomaly & clause flagging.
 * 4. Matching & Notifications: computes skill match scores and notifies contractors.
 */
export async function runPipeline(options = {}) {
    await connectDB();

    const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 5;
    const allowBrowser = options.allowBrowser !== false;
    const force = Boolean(options.force);
    const announcementStorage = options.announcementStorage || 'remote';
    const deptIds = Array.isArray(options.depts) && options.depts.length
        ? options.depts
        : await defaultDepartmentIds();

    const keywordSets = await loadKeywordSets();
    const ctx = createAcquisitionContext({ allowBrowser });

    const summary = {
        discovered: 0,
        candidates: 0,
        documentsAcquired: 0,
        processed: 0,
        notified: 0,
        errors: [],
    };

    try {
        // --- PHASE 1: DISCOVERY & INGESTION ---
        updateProgress({
            phase: 'discovery',
            progress: {
                stage: 'discovering_tenders',
                message: `กำลังดึงข้อมูลประกาศจัดซื้อจัดจ้างจาก RSS (${deptIds.length} หน่วยงาน)...`,
                current: 0,
                total: limit,
                percent: 10,
            },
        });

        let tenders = [];
        if (Array.isArray(options.tenders)) {
            tenders = options.tenders.slice(0, limit);
        } else if (Array.isArray(options.projectIds) && options.projectIds.length) {
            tenders = options.projectIds.map(id => ({ projectId: id, title: `Project ${id}` }));
        } else {
            tenders = await collectOpenTenders({
                deptIds,
                maxProjects: limit,
                onError: ({ deptId, type, error }) => {
                    summary.errors.push({ step: 'discovery', deptId, type, message: error.message });
                },
            });
        }

        summary.discovered = tenders.length;
        updateProgress({
            summary: { discovered: summary.discovered },
            progress: { percent: 20 },
        });

        // --- PHASE 2: FILTER CANDIDATES & ACQUIRE DOCUMENTS ---
        updateProgress({
            phase: 'acquisition',
            progress: {
                stage: 'acquiring_documents',
                message: `พบ ${tenders.length} โครงการ กำลังคัดกรองและดาวน์โหลดเอกสาร TOR...`,
                current: 0,
                total: tenders.length,
                percent: 20,
            },
        });

        const acquiredProjects = [];

        for (let i = 0; i < tenders.length; i++) {
            const tender = tenders[i];
            updateProgress({
                progress: {
                    current: i + 1,
                    total: tenders.length,
                    percent: Math.round(20 + ((i + 1) / Math.max(1, tenders.length)) * 30),
                    message: `[${i + 1}/${tenders.length}] ตรวจสอบเอกสารโครงการ ${tender.projectId}...`,
                },
            });

            try {
                const project = await upsertTenderProject(tender);
                const classification = await classifyTender(project, keywordSets);

                if (classification.isSoftware !== true && !options.all) {
                    continue;
                }
                summary.candidates += 1;

                const alreadyPaired = !force && project.primary_document_id && project.announcement_document_id
                    && project.announcement_schedule?.parser_version === SCHEDULE_VERSION
                    && project.announcement_schedule?.status === 'parsed';

                if (alreadyPaired) {
                    acquiredProjects.push(project);
                    continue;
                }

                const scheduleOnly = !force && Boolean(project.primary_document_id);
                const outcome = await acquireTenderDocuments(
                    scheduleOnly ? { ...tender, draftLink: null } : tender,
                    scheduleOnly ? { ...ctx, allowBrowser: false } : ctx,
                    { checkEligibility: a => announcementProcurementEligibility(project, a) }
                );

                await persistDocuments(project, tender, outcome, announcementStorage);

                if (announcementStorage === 'remote' && outcome.announcement?.path) {
                    await removeTransientDocuments({ pdf_path: outcome.announcement.path });
                }

                if (outcome.tor || project.primary_document_id) {
                    summary.documentsAcquired += 1;
                    acquiredProjects.push(await Project.findOne({ project_id: tender.projectId }).lean());
                }
            } catch (err) {
                summary.errors.push({ step: 'acquisition', projectId: tender.projectId, message: err.message });
            }
        }

        // --- PHASE 3: OCR & VERTEX AI SUMMARIZATION & ANOMALY DETECTION ---
        updateProgress({
            phase: 'processing',
            summary: {
                candidates: summary.candidates,
                documentsAcquired: summary.documentsAcquired,
            },
            progress: {
                stage: 'processing_documents',
                message: `กำลังประมวลผล OCR และวิเคราะห์ความเสี่ยงด้วย Vertex AI (${acquiredProjects.length} รายการ)...`,
                current: 0,
                total: acquiredProjects.length,
                percent: 50,
            },
        });

        const completedProjects = [];

        for (let i = 0; i < acquiredProjects.length; i++) {
            const project = acquiredProjects[i];
            updateProgress({
                progress: {
                    current: i + 1,
                    total: acquiredProjects.length,
                    percent: Math.round(50 + ((i + 1) / Math.max(1, acquiredProjects.length)) * 35),
                    message: `[${i + 1}/${acquiredProjects.length}] ถอดความและวิเคราะห์โครงการ ${project.project_id}...`,
                },
            });

            try {
                const procResult = await processProject(project.project_id, {
                    allowBrowserFallback: allowBrowser,
                    onProgress: p => {
                        updateProgress({
                            progress: {
                                message: `วิเคราะห์ AI ${project.project_id}: ${p.stage || 'running'}`,
                            },
                        });
                    },
                });

                if (procResult.status === 'completed' || procResult.status === 'review_required') {
                    summary.processed += 1;
                    const freshProject = await Project.findOne({ project_id: project.project_id }).lean();
                    if (freshProject) completedProjects.push(freshProject);
                }
            } catch (err) {
                summary.errors.push({ step: 'processing', projectId: project.project_id, message: err.message });
            }
        }

        // --- PHASE 4: CONTRACTOR MATCHING & NOTIFICATIONS ---
        updateProgress({
            phase: 'notification',
            summary: { processed: summary.processed },
            progress: {
                stage: 'matching_and_notifying',
                message: `กำลังตรวจสอบคะแนนความเข้ากันได้กับผู้รับเหมาและส่งการแจ้งเตือน...`,
                current: 0,
                total: completedProjects.length,
                percent: 90,
            },
        });

        if (completedProjects.length > 0) {
            try {
                const notifyResult = await notifyUsersOfMatchingTors(completedProjects);
                summary.notified = notifyResult.notified || 0;
            } catch (err) {
                summary.errors.push({ step: 'notification', message: err.message });
            }
        }

        // --- PIPELINE COMPLETED ---
        const completedAt = new Date().toISOString();
        updateProgress({
            status: 'completed',
            phase: 'completed',
            completedAt,
            summary,
            progress: {
                stage: 'completed',
                current: acquiredProjects.length,
                total: acquiredProjects.length,
                percent: 100,
                message: `การประมวลผลเสร็จสมบูรณ์: นำเข้า ${summary.documentsAcquired} เอกสาร, สรุปแล้ว ${summary.processed} รายการ, แจ้งเตือนผู้รับเหมา ${summary.notified} ครั้ง`,
            },
        });

        return getStatus();
    } catch (fatalError) {
        const completedAt = new Date().toISOString();
        updateProgress({
            status: 'failed',
            phase: 'failed',
            error: fatalError.message,
            completedAt,
            progress: {
                stage: 'failed',
                message: `เกิดข้อผิดพลาดร้ายแรง: ${fatalError.message}`,
            },
        });
        throw fatalError;
    } finally {
        await closeAcquisitionContext(ctx);
    }
}

/**
 * Triggers the pipeline. If async, runs in background and returns accepted status.
 */
export function triggerPipeline(options = {}) {
    if (currentRun.status === 'running') {
        const err = new Error('A data pipeline run is already in progress');
        err.code = 'PIPELINE_ALREADY_RUNNING';
        throw err;
    }

    const runId = `pipe_${Date.now()}`;
    currentRun = {
        ...initialRunState(),
        id: runId,
        status: 'running',
        phase: 'starting',
        startedAt: new Date().toISOString(),
        progress: {
            current: 0,
            total: 0,
            percent: 5,
            stage: 'initializing',
            message: 'กำลังเตรียมการเริ่มต้น Pipeline...',
        },
    };

    if (options.sync) {
        return runPipeline(options);
    }

    // Launch asynchronously in background
    runPipeline(options).catch(error => {
        console.error(`❌ Background pipeline run ${runId} failed:`, error);
    });

    return getStatus();
}

export const pipelineRunner = {
    getStatus,
    resetStatus,
    triggerPipeline,
    runPipeline,
};

export default pipelineRunner;
