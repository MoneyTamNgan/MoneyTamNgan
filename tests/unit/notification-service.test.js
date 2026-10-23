import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    calculateMatchScore,
    notifyUsersOfMatchingTors,
    sendDailyDigest,
} from '../../lib/services/notification-service.js';
import { User } from '../../models/User.js';
import * as emailModule from '../../lib/email.js';

vi.mock('../../lib/db.js', () => ({
    default: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../models/User.js', () => ({
    User: {
        find: vi.fn(),
    },
}));

vi.mock('../../lib/email.js', () => ({
    sendMatchNotificationEmail: vi.fn(),
}));

describe('Notification Service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('calculateMatchScore', () => {
        it('calculates percentage overlap and rounds up', () => {
            const userSkills = ['React', 'Node.js', 'TypeScript'];
            const torTechStack = ['React', 'Node.js', 'Python'];
            // 2 of 3 matched -> 66.67% -> Math.ceil -> 67
            expect(calculateMatchScore(userSkills, torTechStack)).toBe(67);
        });

        it('returns 0 when torTechStack is empty or undefined', () => {
            expect(calculateMatchScore(['React'], [])).toBe(0);
            expect(calculateMatchScore(['React'], null)).toBe(0);
        });

        it('handles skill aliases and parenthetical definitions', () => {
            const userSkills = ['Enterprise Resource Planning (ERP)', 'Integration Platforms as a Service (iPaaS)'];
            const torTechStack = ['ERP', 'ipaas'];
            expect(calculateMatchScore(userSkills, torTechStack)).toBe(100);
        });
    });

    describe('notifyUsersOfMatchingTors (IMMEDIATE)', () => {
        it('returns 0 notified if no projects provided', async () => {
            const result = await notifyUsersOfMatchingTors([]);
            expect(result).toEqual({ notified: 0, skipped: 0 });
            expect(User.find).not.toHaveBeenCalled();
        });

        it('notifies only immediate-frequency users whose score meets the threshold', async () => {
            const mockUsers = [
                {
                    email: 'disabled@example.com',
                    email_notifications_enabled: false,
                    notification_frequency: 'IMMEDIATE',
                    skills: ['React'],
                },
                {
                    email: 'digest@example.com',
                    email_notifications_enabled: true,
                    notification_frequency: 'DAILY_DIGEST',
                    skills: ['React'],
                },
                {
                    email: 'low_score@example.com',
                    name: 'Low Scorer',
                    email_notifications_enabled: true,
                    notification_frequency: 'IMMEDIATE',
                    match_score_threshold: 80,
                    skills: ['React'], // only 1 of 2 matched -> 50% < 80%
                },
                {
                    email: 'matched@example.com',
                    name: 'Perfect Match',
                    company_name: 'Tech Co',
                    email_notifications_enabled: true,
                    notification_frequency: 'IMMEDIATE',
                    match_score_threshold: 70,
                    skills: ['React', 'Node.js'],
                },
            ];

            vi.mocked(User.find).mockReturnValue({
                lean: vi.fn().mockResolvedValue(mockUsers),
            });

            vi.mocked(emailModule.sendMatchNotificationEmail).mockResolvedValue({ id: 'msg-123' });

            const projects = [
                {
                    project_id: 'PRJ-001',
                    project_name: 'ระบบคลาวด์ภาครัฐ',
                    dept_name: 'สพร.',
                    budget: 10000000,
                    extracted_data: { tech_stack: ['React', 'Node.js'] },
                },
            ];

            const result = await notifyUsersOfMatchingTors(projects);

            expect(result.notified).toBe(1);
            expect(result.skipped).toBe(3);

            expect(emailModule.sendMatchNotificationEmail).toHaveBeenCalledTimes(1);
            expect(emailModule.sendMatchNotificationEmail).toHaveBeenCalledWith({
                to: 'matched@example.com',
                userName: 'Perfect Match',
                matches: [
                    {
                        torId: 'PRJ-001',
                        title: 'ระบบคลาวด์ภาครัฐ',
                        agency: 'สพร.',
                        budget: 10000000,
                        matchScore: 100,
                    },
                ],
            });
        });

        it('sorts matching TORs in descending order of matchScore', async () => {
            const user = {
                email: 'test@example.com',
                name: 'Dev',
                email_notifications_enabled: true,
                notification_frequency: 'IMMEDIATE',
                match_score_threshold: 50,
                skills: ['React', 'Node.js', 'Python'],
            };

            vi.mocked(User.find).mockReturnValue({
                lean: vi.fn().mockResolvedValue([user]),
            });

            vi.mocked(emailModule.sendMatchNotificationEmail).mockResolvedValue({ id: 'msg-1' });

            const projects = [
                {
                    project_id: 'PRJ-MID',
                    project_name: 'Mid Match',
                    dept_name: 'Dept A',
                    budget: 500000,
                    extracted_data: { tech_stack: ['React', 'Go'] }, // 50%
                },
                {
                    project_id: 'PRJ-HIGH',
                    project_name: 'High Match',
                    dept_name: 'Dept B',
                    budget: 1500000,
                    extracted_data: { tech_stack: ['React', 'Node.js'] }, // 100%
                },
            ];

            const result = await notifyUsersOfMatchingTors(projects);

            expect(result.notified).toBe(1);
            const callArgs = vi.mocked(emailModule.sendMatchNotificationEmail).mock.calls[0][0];
            expect(callArgs.matches[0].torId).toBe('PRJ-HIGH');
            expect(callArgs.matches[0].matchScore).toBe(100);
            expect(callArgs.matches[1].torId).toBe('PRJ-MID');
            expect(callArgs.matches[1].matchScore).toBe(50);
        });
    });

    describe('sendDailyDigest (DAILY_DIGEST)', () => {
        it('sends digest to users configured for DAILY_DIGEST', async () => {
            const user = {
                email: 'digest-user@example.com',
                company_name: 'ACME Corp',
                email_notifications_enabled: true,
                notification_frequency: 'DAILY_DIGEST',
                match_score_threshold: 60,
                skills: ['React', 'PostgreSQL'],
            };

            vi.mocked(User.find).mockReturnValue({
                lean: vi.fn().mockResolvedValue([user]),
            });

            vi.mocked(emailModule.sendMatchNotificationEmail).mockResolvedValue({ id: 'msg-digest' });

            const projects = [
                {
                    project_id: 'TOR-101',
                    project_name: 'ระบบฐานข้อมูลจัดซื้อ',
                    dept_name: 'กรมบัญชีกลาง',
                    budget: 3000000,
                    extracted_data: { tech_stack: ['React', 'PostgreSQL'] },
                },
            ];

            const result = await sendDailyDigest(projects);

            expect(result.notified).toBe(1);
            expect(emailModule.sendMatchNotificationEmail).toHaveBeenCalledWith(
                expect.objectContaining({
                    to: 'digest-user@example.com',
                    userName: 'ACME Corp',
                    matches: expect.arrayContaining([
                        expect.objectContaining({
                            torId: 'TOR-101',
                            matchScore: 100,
                        }),
                    ]),
                })
            );
        });
    });
});
