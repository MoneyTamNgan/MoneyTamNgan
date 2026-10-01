import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import { sendDailyDigest } from '@/lib/email';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
    // Function to calculate match score between user skills and TOR tech stack
    function calculateMatchScore(userSkills, torTechStack) {
        if (!torTechStack || torTechStack.length === 0) return 0;
        const normUser = new Set((userSkills || []).map(normaliseSkill));
        const normTor = torTechStack.map(normaliseSkill);
        const matched = normTor.filter((skill) => normUser.has(skill)).length;
        return Math.round((matched / normTor.length) * 100);
    }

    // Helper function to normalise user skills
    function normaliseSkill(raw) {
        const lower = raw.toLowerCase().trim();
        return SKILL_ALIASES[lower] ?? lower;
    }

    try {
        const { projects } = await req.json();

        // Calculate match scores and send notifications for users
        await connectDB();
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

            if (sent) notified++;
            else skipped++;
        }

        return { notified, skipped };
    } catch (error) {
        console.error('Error sending daily digest:', error);
        return NextResponse.json({ error: 'Failed to send daily digest' }, { status: 500 });
    }
}
