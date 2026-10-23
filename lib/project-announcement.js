import Project from '../models/Project.js';
import { fetchAnnouncementFeed, tenderStatus } from './egp-rss.js';
import { extractAnnouncementSchedule } from './tender-acquisition.js';
import { announcementScheduleFields, announcementProcurementEligibility, SCHEDULE_VERSION } from './announcement-schedule.js';
import { downloadAttachment } from './scraper.js';
import { hashFile, removeTransientDocuments } from './document-storage.js';
import { persistAnnouncementRecord, withMongoTransaction } from './mongo-artifacts.js';
import { verifyProcurementEligibility, assessProcurementEligibility } from './procurement-eligibility.js';

const cache = new Map();
let nextFeedAt = 0;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export function officialInvitationUrl(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'process5.gprocurement.go.th'
        || url.username || url.password || url.pathname !== '/egp-template-service/dwnt/view-pdf-file'
        || !url.searchParams.get('templateId')) throw new Error('Invalid official invitation URL');
    return url.href;
}

/** Never guess a template ID or scan all departments for every job. */
export async function findProjectInvitation(project, {
    feed = fetchAnnouncementFeed, now = Date.now, sleep = wait,
} = {}) {
    if (project.tender?.invitation_url) return { url: officialInvitationUrl(project.tender.invitation_url) };
    const ids = [...new Set([project.tender?.rss_dept_id, project.source?.rss_dept_id, project.rss_dept_id, project.dept_id,
        ...(process.env.EGP_RSS_DEPT_IDS || '').split(',')].filter(id => /^\d{4}$/.test(String(id))))].slice(0, 4);
    if (!ids.length) return null;
    for (const deptId of ids) {
        let entry = cache.get(String(deptId));
        if (!entry || entry.expires <= now() || feed !== fetchAnnouncementFeed) {
            const start = Math.max(now(), nextFeedAt);
            nextFeedAt = start + 4000;
            await sleep(Math.max(0, start - now()));
            const promise = feed({ deptId, type: 'D0', timeoutMs: 5000 });
            entry = { expires: now() + 300000, promise };
            if (feed === fetchAnnouncementFeed) cache.set(String(deptId), entry);
        }
        try {
            const items = await entry.promise;
            const matches = items.filter(item => String(item.projectId) === String(project.project_id));
            const urls = [...new Set(matches.map(item => officialInvitationUrl(item.link)))];
            if (urls.length > 1) throw new Error('Conflicting invitation versions in RSS; source review required');
            if (urls.length === 1) return { url: urls[0], deptId };
        } catch (error) {
            if (feed === fetchAnnouncementFeed) cache.delete(String(deptId));
            throw error;
        }
    }
    return null;
}

/** API/worker counterpart of CLI announcement processing; no TOR, OCR-history or summary overwrites. */
export async function syncProjectAnnouncement(project, {
    lookup = findProjectInvitation, download = downloadAttachment,
    extract = extractAnnouncementSchedule, hash = hashFile,
    register = persistAnnouncementRecord, transaction = withMongoTransaction,
    Projects = Project, cleanup = removeTransientDocuments, storageDir, now = new Date(),
} = {}) {
    const previous = project.announcement_schedule;
    const age = now.getTime() - new Date(previous?.extracted_at || 0).getTime();
    if (previous?.parser_version === SCHEDULE_VERSION && age >= 0 && age < 900000
        && (previous.status !== 'parsed' || String(previous.document_id) === String(project.announcement_document_id))
        && (!project.tender?.invitation_url || previous.source_url === project.tender.invitation_url)) {
        return { project, status: previous.status, reused: true };
    }
    let file;
    let invitation;
    let committing = false;
    try {
        invitation = await lookup(project);
        if (!invitation) {
            const state = { parser_version: SCHEDULE_VERSION, status: 'not_found', extracted_at: now,
                error: 'No matching invitation. Provide source.rss_dept_id, tender.invitation_url or EGP_RSS_DEPT_IDS.',
                warnings: ['announcement_unavailable'], evidence: [] };
            committing = true;
            await Projects.updateOne({ _id: project._id }, { $set: { announcement_schedule: state } });
            return { project: { ...project, announcement_schedule: state }, status: 'not_found' };
        }
        officialInvitationUrl(invitation.url);
        file = await download({ name: `announcement-${project.project_id}.pdf`, type: 'pdf', url: invitation.url },
            { projectId: project.project_id, storageDir });
        const extracted = await extract(file.path);
        const persisted = { ...await hash(file.path), backend: 'remote' };
        let fields;
        committing = true;
        await transaction(async session => {
            const document = await register(project, { ...file, url: invitation.url }, persisted, {}, { session });
            fields = announcementScheduleFields(extracted.schedule, { documentId: document._id, sourceUrl: invitation.url,
                method: extracted.method, error: extracted.error });
            fields.announcement_schedule.extracted_at = now;
            fields['tender.status'] = tenderStatus({ hasDraft: Boolean(project.tender?.draft_url), hasInvitation: true,
                closesAt: fields['tender.closes_at'] }, now);
            const eligibility = announcementProcurementEligibility(project, { url: invitation.url, schedule: extracted.schedule }, { now });
            if (eligibility.status === 'closed') fields.procurement_eligibility = eligibility;
            fields.announcement_document_id = document._id;
            fields['tender.invitation_url'] = invitation.url;
            if (invitation.deptId) fields['tender.rss_dept_id'] = invitation.deptId;
            await Projects.updateOne({ _id: project._id }, { $set: fields }, { session, runValidators: true });
            if (String(project.announcement_document_id || '') !== String(document._id)) {
                await Projects.updateOne({ _id: project._id }, { $unset: {
                    announcement_extraction_run_id: '', announcement_summary_id: '',
                    announcement_fiscal_budget: '', announcement_analysis: '',
                } }, { session });
            }
        });
        const updated = { ...project, bidding_date: fields.bidding_date, submission_schedule: fields.submission_schedule,
            announcement_document_id: fields.announcement_document_id, announcement_schedule: fields.announcement_schedule,
            ...(fields.procurement_eligibility ? { procurement_eligibility: fields.procurement_eligibility } : {}),
            tender: { ...project.tender, status: fields['tender.status'], invitation_url: invitation.url, closes_at: fields['tender.closes_at'] } };
        if (String(project.announcement_document_id || '') !== String(updated.announcement_document_id)) {
            for (const field of ['announcement_extraction_run_id', 'announcement_summary_id', 'announcement_fiscal_budget', 'announcement_analysis']) delete updated[field];
        }
        return { project: updated, status: extracted.schedule.status,
            eligibility: announcementProcurementEligibility(project, { url: invitation.url, schedule: extracted.schedule }, { now }) };
    } catch (error) {
        // Database failures must remain retryable; do not hide partial transaction errors.
        if (committing) throw error;
        const state = { parser_version: SCHEDULE_VERSION, status: 'needs_review', extracted_at: now,
            source_url: invitation?.url, error: error.message.slice(0, 500), warnings: ['announcement_unavailable'], evidence: [] };
        await Projects.updateOne({ _id: project._id }, { $set: { announcement_schedule: state } });
        return { project: { ...project, announcement_schedule: state }, status: 'needs_review', error: state.error };
    } finally {
        if (file) await cleanup({ pdf_path: file.path });
    }
}

/** Official-page evidence wins; a current matching RSS invitation is a bounded fallback. */
export async function verifyProcurementWithAnnouncement(record, {
    verifyOfficial = verifyProcurementEligibility, lookup = findProjectInvitation,
    download = downloadAttachment, extract = extractAnnouncementSchedule, cleanup = removeTransientDocuments,
    now = new Date(),
} = {}) {
    const official = await verifyOfficial(record);
    if (official.status !== 'unknown') return official;
    const closed = assessProcurementEligibility(record, { now });
    if (closed.status === 'closed' && closed.reason !== 'Bid submission deadline has passed') return closed;
    let file;
    try {
        const state = record.announcement_schedule;
        const age = now.getTime() - new Date(state?.extracted_at || 0).getTime();
        if (state?.status === 'parsed' && age >= 0 && age < 900000 && record.announcement_document_id
            && String(state.document_id) === String(record.announcement_document_id)
            && state.parser_version === SCHEDULE_VERSION && state.source_url === record.tender?.invitation_url) {
            officialInvitationUrl(state.source_url);
            return { ...announcementProcurementEligibility(record, {
                url: state.source_url, schedule: { status: 'parsed', submission_schedule: record.submission_schedule },
            }, { now }), announcement_url: state.source_url };
        }
        const invitation = await lookup(record);
        if (!invitation) return { ...official, reason: `${official.reason}; no matching RSS invitation` };
        officialInvitationUrl(invitation.url);
        file = await download({ name: `announcement-${record.project_id}.pdf`, type: 'pdf', url: invitation.url },
            { projectId: record.project_id });
        const result = await extract(file.path);
        const eligible = announcementProcurementEligibility(record, { url: invitation.url, schedule: result.schedule }, { now });
        return { ...eligible, announcement_url: invitation.url, rss_dept_id: invitation.deptId };
    } catch (error) {
        return { ...official, reason: `${official.reason}; announcement unavailable: ${error.message}`.slice(0, 1000) };
    } finally { if (file) await cleanup({ pdf_path: file.path }); }
}
