import connectDB from '../db.js';
import { User } from '../../models/User.js';
import { buildMatchNotificationEmail, sendMatchNotificationEmail } from '../email.js';
import { calculateSkillMatchScore, normalizeSkill, SKILL_ALIASES } from '../matchingEngine.js';
import { hydrateProjectsCompatibility } from '../project-compat.js';
import { notificationStore, MAX_NOTIFICATION_ATTEMPTS, RETRY_WINDOW_MS } from '../notification-store.js';

export { calculateSkillMatchScore, normalizeSkill, SKILL_ALIASES };
// #96 is not merged: keep a named scoring adapter so switching to its overall score is explicit.
export const NOTIFICATION_SCORE_VERSION = 'skill-v1';
export function calculateMatchScore(userSkills, torTechStack) {
    if (!torTechStack?.length) return 0; // legacy public helper contract
    return calculateSkillMatchScore({ skills: userSkills }, { extracted_data: { tech_stack: torTechStack } });
}
export function usableNotificationEmail(value) {
    return typeof value === 'string' && value.length <= 254 && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value);
}
export function maskNotificationEmail(value) {
    return usableNotificationEmail(value) ? `${value[0]}***@***` : '[unavailable]';
}

export function createNotificationService({ connect = connectDB, users = User, store = notificationStore,
    hydrate = hydrateProjectsCompatibility, send = sendMatchNotificationEmail, build = buildMatchNotificationEmail,
    score = calculateSkillMatchScore, now = () => new Date(), log = event => console.log('[notification]', JSON.stringify(event)),
} = {}) {
    const safeLog = event => { try { log(event); } catch { /* logging cannot break ingestion */ } };
    async function dispatch(user, frequency, existingOnly = false) {
        let sent = 0;
        // One immutable batch per user at a time; process at most 150 projects per invocation.
        for (let i = 0; i < 10; i++) {
            const batch = await store.prepare(user, frequency, matches => build({
                to: user.email, userName: user.name || user.company_name || 'ผู้ใช้งาน', matches,
            }), existingOnly);
            if (!batch) break;
            const claimed = await store.claim(batch, now());
            if (!claimed) break;
            // Re-read preferences immediately before sending, including retry and digest sends.
            const current = await users.findById(user._id).lean();
            let status = 'pending', providerId, errorCode;
            if (!current?.email_notifications_enabled || !usableNotificationEmail(current.email)
                || current.email !== claimed.payload.to) {
                status = 'cancelled'; errorCode = 'PREFERENCES_CHANGED';
            } else if ((current.notification_frequency || 'IMMEDIATE') !== frequency) {
                // Do not send at the wrong frequency; release this batch for operator reconciliation.
                status = 'cancelled'; errorCode = 'FREQUENCY_CHANGED';
            } else if (claimed.attempts > MAX_NOTIFICATION_ATTEMPTS
                || now().getTime() - new Date(claimed.first_attempt_at).getTime() >= RETRY_WINDOW_MS) {
                status = 'failed'; errorCode = 'RETRY_LIMIT';
            } else {
                try {
                    const result = await send({ rendered: claimed.payload,
                        idempotencyKey: `tor-match/${claimed._id}`, requireResend: true });
                    if (result?.id) { status = 'sent'; providerId = result.id; }
                    else errorCode = 'PROVIDER_UNAVAILABLE';
                } catch { errorCode = 'PROVIDER_UNAVAILABLE'; }
                if (status === 'pending' && claimed.attempts >= MAX_NOTIFICATION_ATTEMPTS) status = 'failed';
            }
            const settled = await store.settle(claimed, { status, providerId, errorCode }, now());
            safeLog({ userId: String(user._id), recipient: maskNotificationEmail(user.email),
                batchId: String(claimed._id), outcome: settled ? status : 'lease_lost', attempt: claimed.attempts });
            if (status === 'sent' && settled) sent++;
            else break;
        }
        return sent;
    }
    async function run(projects, frequency) {
        const result = { notified: 0, skipped: 0 };
        try {
            await connect();
            const candidates = projects?.length ? await hydrate(projects) : [];
            const enabled = await users.find({ email_notifications_enabled: true }).lean();
            for (const user of enabled) {
                if (!user.email_notifications_enabled || !usableNotificationEmail(user.email)) { result.skipped++; continue; }
                try {
                    for (const project of candidates) {
                        // Never treat absent/unprocessed extraction as the scoring engine's neutral 100%.
                        if (!project.project_id || !project.extracted_data) continue;
                        const matchScore = score(user, project);
                        const threshold = Number.isFinite(user.match_score_threshold) ? user.match_score_threshold : 70;
                        if (!Number.isFinite(matchScore) || matchScore < threshold) continue;
                        await store.enqueue(user, project, { torId: project.project_id,
                            title: project.project_name || project.title || 'โครงการไม่ระบุชื่อ',
                            agency: project.dept_name || project.agency || '-', budget: project.budget ?? null, matchScore,
                        }, NOTIFICATION_SCORE_VERSION);
                    }
                    if ((user.notification_frequency || 'IMMEDIATE') !== frequency) { result.skipped++; continue; }
                    const count = await dispatch(user, frequency);
                    if (count) result.notified++;
                    else result.skipped++;
                } catch { safeLog({ userId: String(user._id), outcome: 'storage_unavailable' }); result.skipped++; }
            }
        } catch { safeLog({ outcome: 'notification_unavailable' }); }
        return result;
    }
    async function retryPendingNotifications() {
        const result = { notified: 0, skipped: 0 };
        try {
            await connect();
            const enabled = await users.find({ email_notifications_enabled: true }).lean();
            for (const user of enabled) {
                if (!usableNotificationEmail(user.email)) continue;
                try {
                    if (await dispatch(user, user.notification_frequency || 'IMMEDIATE', true)) result.notified++;
                    else result.skipped++;
                } catch { safeLog({ userId: String(user._id), outcome: 'storage_unavailable' }); result.skipped++; }
            }
        } catch { safeLog({ outcome: 'notification_unavailable' }); }
        return result;
    }
    return {
        retryPendingNotifications,
        notifyUsersOfMatchingTors: projects => run(projects, 'IMMEDIATE'),
        sendDailyDigest: (projects = null) => run(projects, 'DAILY_DIGEST'),
    };
}
const service = createNotificationService();
export const notifyUsersOfMatchingTors = service.notifyUsersOfMatchingTors;
export const sendDailyDigest = service.sendDailyDigest;

export const retryPendingNotifications = service.retryPendingNotifications;
