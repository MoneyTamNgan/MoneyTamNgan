import connectDB from '../db.js';
import { User } from '../../models/User.js';
import { sendMatchNotificationEmail } from '../email.js';
import { calculateSkillMatchScore, normalizeSkill, SKILL_ALIASES } from '../matchingEngine.js';

export { calculateSkillMatchScore, normalizeSkill, SKILL_ALIASES };

/**
 * Calculates the match percentage between user skills and a TOR tech stack.
 *
 * @param {string[]} userSkills - List of contractor skills
 * @param {string[]} torTechStack - List of required technologies from TOR
 * @returns {number} 0-100 integer
 */
export function calculateMatchScore(userSkills, torTechStack) {
    if (!torTechStack || torTechStack.length === 0) return 0;
    return calculateSkillMatchScore(
        { skills: userSkills },
        { extracted_data: { tech_stack: torTechStack } }
    );
}

/**
 * Given a list of newly-available or updated TOR projects, find all users
 * that have email notifications enabled with IMMEDIATE frequency, and send
 * them an alert when their match score meets or exceeds their personal threshold.
 *
 * @param {Array<Object>} projects - Hydrated project objects or MongoDB records
 * @returns {Promise<{ notified: number, skipped: number }>}
 */
export async function notifyUsersOfMatchingTors(projects) {
    if (!projects || projects.length === 0) return { notified: 0, skipped: 0 };

    await connectDB();

    // Only load users that have email notifications enabled
    const users = await User.find({ email_notifications_enabled: true }).lean();
    if (!users.length) return { notified: 0, skipped: 0 };

    let notified = 0;
    let skipped = 0;

    for (const user of users) {
        if (user.notification_frequency !== 'IMMEDIATE') {
            skipped++;
            continue;
        }

        if (!user.email) {
            skipped++;
            continue;
        }

        const threshold = user.match_score_threshold ?? 70;

        const matchingTors = projects
            .map((p) => {
                const matchScore = calculateSkillMatchScore(user, p);
                return {
                    torId: p.project_id ?? p.id ?? String(p._id ?? ''),
                    title: p.project_name ?? p.title ?? 'โครงการไม่ระบุชื่อ',
                    agency: p.dept_name ?? p.agency ?? '-',
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

        try {
            const sent = await sendMatchNotificationEmail({
                to: user.email,
                userName: user.name || user.company_name || 'ผู้ใช้งาน',
                matches: matchingTors,
            });

            if (sent) {
                notified++;
            } else {
                skipped++;
            }
        } catch (err) {
            console.error(`[notification] Failed sending immediate email to ${user.email}:`, err);
            skipped++;
        }
    }

    return { notified, skipped };
}

/**
 * Send a digest email to every DAILY_DIGEST user that has at least one
 * matching project from the provided list (or queried from DB).
 *
 * @param {Array<Object>|null} projects - List of projects, or null to query DB
 * @returns {Promise<{ notified: number, skipped: number }>}
 */
export async function sendDailyDigest(projects = null) {
    await connectDB();

    let candidateProjects = Array.isArray(projects) && projects.length > 0 ? projects : null;

    if (!candidateProjects) {
        const Project = (await import('../../models/Project.js')).default;
        candidateProjects = await Project.find({
            $or: [
                { 'extracted_data.tech_stack.0': { $exists: true } },
                { 'techStack.0': { $exists: true } },
            ],
        })
            .sort({ updated_at: -1 })
            .limit(200)
            .lean();
    }

    if (!candidateProjects || candidateProjects.length === 0) {
        return { notified: 0, skipped: 0 };
    }

    const users = await User.find({
        email_notifications_enabled: true,
        notification_frequency: 'DAILY_DIGEST',
    }).lean();

    if (!users.length) return { notified: 0, skipped: 0 };

    let notified = 0;
    let skipped = 0;

    for (const user of users) {
        if (!user.email) {
            skipped++;
            continue;
        }

        const threshold = user.match_score_threshold ?? 70;

        const matchingTors = candidateProjects
            .map((p) => {
                const matchScore = calculateSkillMatchScore(user, p);
                return {
                    torId: p.project_id ?? p.id ?? String(p._id ?? ''),
                    title: p.project_name ?? p.title ?? 'โครงการไม่ระบุชื่อ',
                    agency: p.dept_name ?? p.agency ?? '-',
                    budget: p.budget ?? null,
                    matchScore,
                };
            })
            .filter((m) => m.matchScore >= threshold && m.torId)
            .sort((a, b) => b.matchScore - a.matchScore)
            .slice(0, 15); // Top 15 in daily digest

        if (matchingTors.length === 0) {
            skipped++;
            continue;
        }

        try {
            const sent = await sendMatchNotificationEmail({
                to: user.email,
                userName: user.name || user.company_name || 'ผู้ใช้งาน',
                matches: matchingTors,
            });

            if (sent) {
                notified++;
            } else {
                skipped++;
            }
        } catch (err) {
            console.error(`[notification] Failed sending digest email to ${user.email}:`, err);
            skipped++;
        }
    }

    return { notified, skipped };
}
