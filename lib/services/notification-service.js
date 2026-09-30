import nodemailer from 'nodemailer';

/**
 * Notification Service
 *
 * Responsible for:
 *  1. Computing skill match scores between users and a list of TOR projects.
 *  2. Filtering users that want notifications and whose score meets their threshold.
 *  3. Sending emails via Resend (IMMEDIATE mode) or collecting records for DAILY_DIGEST.
 */

import connectDB from '@/lib/db';
import { User } from '@/models/User';
import { sendMatchNotificationEmail } from '@/lib/email';

// ─── Keyword normalisation (mirrors the logic in the matching engine) ────────

const SKILL_ALIASES = {
    'service virtualization': 'service virtualization',
    'ipaas': 'ipaas',
    'integration platforms as a service': 'ipaas',
    'ms project': 'ms project',
    'microsoft project': 'ms project',
    'ms excel': 'ms excel',
    'microsoft excel': 'ms excel',
    'excel': 'ms excel',
    'utp': 'utility platform',
    'utility platform': 'utility platform',
    'erp': 'erp',
    'enterprise resource planning': 'erp',
    'ระบบคอมพิวเตอร์': 'computer system',
    'computer system': 'computer system',
};

function normaliseSkill(raw) {
    const lower = raw.toLowerCase().trim();
    return SKILL_ALIASES[lower] ?? lower;
}

/**
 * Calculate the match percentage between user skills and a TOR tech stack.
 *
 * @param {string[]} userSkills
 * @param {string[]} torTechStack
 * @returns {number} 0-100 integer
 */
export function calculateMatchScore(userSkills, torTechStack) {
    if (!torTechStack || torTechStack.length === 0) return 0;
    const normUser = new Set((userSkills || []).map(normaliseSkill));
    const normTor = torTechStack.map(normaliseSkill);
    const matched = normTor.filter((skill) => normUser.has(skill)).length;
    return Math.round((matched / normTor.length) * 100);
}

// ─── Core notification dispatch ───────────────────────────────────────────────

/**
 * Given a list of newly-available or updated TOR projects, find all users
 * that have email notifications enabled and send them an alert when their
 * match score meets (or exceeds) their personal threshold.
 *
 * Only users with `frequency === 'IMMEDIATE'` receive emails right away.
 * DAILY_DIGEST users are not emailed here; their batch runs separately.
 *
 * @param {Array<{
 *   project_id: string,
 *   project_name: string,
 *   dept_name: string,
 *   budget: number | null,
 *   extracted_data?: { tech_stack?: string[] },
 * }>} projects  — hydrated project objects (already have extracted_data)
 * @returns {Promise<{ notified: number, skipped: number }>}
 */
export async function notifyUsersOfMatchingTors(projects) {
    if (!projects || projects.length === 0) return { notified: 0, skipped: 0 };

    await connectDB();

    // Only load users that have notifications enabled
    const users = await User.find({ email_notifications_enabled: true }).lean();
    if (!users.length) return { notified: 0, skipped: 0 };

    let notified = 0;
    let skipped = 0;

    for (const user of users) {
        if (user.notification_frequency !== 'IMMEDIATE') {
            skipped++;
            continue;
        }

        const threshold = user.match_score_threshold ?? 70;
        const userSkills = user.skills?.length ? user.skills : (user.techStack || []);

        const matchingTors = projects
            .map((p) => {
                const techStack =
                    p.extracted_data?.tech_stack ||
                    p.techStack ||          // already-shaped list item
                    [];
                const matchScore = calculateMatchScore(userSkills, techStack);
                return {
                    torId: p.project_id ?? p.id,
                    title: p.project_name ?? p.title,
                    agency: p.dept_name ?? p.agency,
                    budget: p.budget ?? null,
                    matchScore,
                };
            })
            .filter((m) => m.matchScore >= threshold && m.torId);

        if (matchingTors.length === 0) {
            skipped++;
            continue;
        }

        // Sort best match first
        matchingTors.sort((a, b) => b.matchScore - a.matchScore);

        const sent = await sendMatchNotificationEmail({
            to: user.email,
            userName: user.name || user.company_name || '',
            matches: matchingTors,
        });

        if (sent) {
            notified++;
        } else {
            skipped++;
        }
    }

    return { notified, skipped };
}

// ─── DAILY_DIGEST batch (called by a scheduled job / cron route) ──────────────

/**
 * Send a digest email to every DAILY_DIGEST user that has at least one
 * matching project from the provided list.
 *
 * @param {Array} projects — same shape as `notifyUsersOfMatchingTors`
 * @returns {Promise<{ notified: number, skipped: number }>}
 */
export async function sendDailyDigest(projects) {
    if (!projects || projects.length === 0) return { notified: 0, skipped: 0 };

    await connectDB();
    const users = await User.find({
        email_notifications_enabled: true,
        notification_frequency: 'DAILY_DIGEST',
    }).lean();

    let notified = 0;
    let skipped = 0;

    for (const user of users) {
        const threshold = user.match_score_threshold ?? 70;
        const userSkills = user.skills?.length ? user.skills : (user.techStack || []);

        const matchingTors = projects
            .map((p) => {
                const techStack = p.extracted_data?.tech_stack || p.techStack || [];
                const matchScore = calculateMatchScore(userSkills, techStack);
                return {
                    torId: p.project_id ?? p.id,
                    title: p.project_name ?? p.title,
                    agency: p.dept_name ?? p.agency,
                    budget: p.budget ?? null,
                    matchScore,
                };
            })
            .filter((m) => m.matchScore >= threshold && m.torId)
            .sort((a, b) => b.matchScore - a.matchScore);

        if (matchingTors.length === 0) {
            skipped++;
            continue;
        }

        const sent = await sendMatchNotificationEmail({
            to: user.email,
            userName: user.name || user.company_name || '',
            matches: matchingTors,
        });

        if (sent) notified++;
        else skipped++;
    }

    return { notified, skipped };
}