import { describe, it, expect, vi } from 'vitest';
import { createNotificationService, calculateMatchScore, maskNotificationEmail } from '../../lib/services/notification-service.js';
import { buildMatchNotificationEmail } from '../../lib/email.js';

const project = { project_id: 'P1', project_name: 'ระบบ React', dept_name: 'DGA', budget: 1000,
    extracted_data: { tech_stack: ['React'] } };
function fixture(overrides = {}) {
    let time = new Date('2026-11-15T00:00:00Z');
    const user = { _id: 'u1', email: 'test@example.com', skills: ['React'], email_notifications_enabled: true,
        notification_frequency: 'IMMEDIATE', ...overrides };
    const rows = new Map(), batches = [];
    const store = {
        enqueue: vi.fn(async (u, p, match, version) => {
            const key = `${u._id}:${p.project_id}`;
            if (rows.has(key)) return false;
            rows.set(key, { match, version, status: 'pending' }); return true;
        }),
        prepare: vi.fn(async (u, frequency, build, existingOnly = false) => {
            const active = batches.find(b => ['pending', 'sending'].includes(b.status));
            if (active) return structuredClone(active);
            if (existingOnly) return null;
            const pending = [...rows.values()].filter(r => r.status === 'pending').slice(0, 15);
            if (!pending.length) return null;
            const batch = { _id: `b${batches.length}`, status: 'pending', attempts: 0,
                frequency, payload: build(pending.map(r => r.match)), rows: pending };
            pending.forEach(r => r.status = 'batched'); batches.push(batch);
            return structuredClone(batch);
        }),
        claim: vi.fn(async (b, at) => {
            const live = batches.find(item => item._id === b._id);
            if (live.status === 'sending' || (live.next && live.next > at)) return null;
            live.status = 'sending'; live.attempts++; live.first_attempt_at ||= at;
            return structuredClone(live);
        }),
        settle: vi.fn(async (b, result, at) => {
            const live = batches.find(item => item._id === b._id);
            Object.assign(live, result);
            if (result.status === 'pending') live.next = new Date(at.getTime() + 60000 * live.attempts);
            else live.rows.forEach(r => r.status = result.status);
            return true;
        }),
    };
    const send = vi.fn(async () => ({ id: 'provider-1' }));
    const log = vi.fn();
    const users = { find: vi.fn(() => ({ lean: async () => [user] })),
        findById: vi.fn(() => ({ lean: async () => user })) };
    const hydrate = vi.fn(async p => p);
    const service = createNotificationService({ connect: async () => {}, users, store, hydrate, send,
        now: () => time, log });
    return { ...service, user, rows, batches, store, send, log, users, hydrate,
        advance: ms => { time = new Date(time.getTime() + ms); } };
}

describe('#39 threshold dispatch', () => {
    it('keeps the legacy overlap helper and aliases', () => {
        expect(calculateMatchScore(['React', 'Node'], ['React', 'Node', 'Go'])).toBe(67);
        expect(calculateMatchScore(['ERP'], ['Enterprise Resource Planning (ERP)'])).toBe(100);
        expect(calculateMatchScore(['React'], [])).toBe(0);
    });
    it('sends at the default 70 threshold, queues with version and never resends', async () => {
        const f = fixture();
        const p = { ...project, extracted_data: { tech_stack: Array.from({ length: 10 }, (_, i) => `skill${i}`) } };
        f.user.skills = p.extracted_data.tech_stack.slice(0, 7);
        expect(await f.notifyUsersOfMatchingTors([p])).toEqual({ notified: 1, skipped: 0 });
        await f.notifyUsersOfMatchingTors([p, p]);
        expect(f.send).toHaveBeenCalledTimes(1);
        expect([...f.rows.values()][0].version).toBe('skill-v1');
        expect(f.send.mock.calls[0][0]).toMatchObject({ idempotencyKey: 'tor-match/b0', requireResend: true });
        expect(f.send.mock.calls[0][0].rendered.html).toContain('70%');
    });
    it('skips below threshold, disabled, unusable email, and unprocessed documents', async () => {
        for (const override of [{ skills: ['Go'] }, { email_notifications_enabled: false },
            { email: '' }, { email: 'invalid' }, { email: 'bad\r\n@example.com' }]) {
            const f = fixture(override); await f.notifyUsersOfMatchingTors([project]);
            expect(f.send).not.toHaveBeenCalled();
        }
        const f = fixture(); await f.notifyUsersOfMatchingTors([{ project_id: 'missing' }]);
        expect(f.send).not.toHaveBeenCalled();
    });
    it('uses normalized hydration before scoring, and neutral empty-stack behavior matches engine', async () => {
        const f = fixture();
        f.hydrate.mockResolvedValue([project]);
        await f.notifyUsersOfMatchingTors([{ project_id: 'P1', latest_summary_id: 'summary1' }]);
        expect(f.send).toHaveBeenCalledOnce();
        const empty = fixture(); await empty.notifyUsersOfMatchingTors([{ ...project, extracted_data: { tech_stack: [] } }]);
        expect(empty.send).toHaveBeenCalledOnce();
    });
    it('queues daily users without sending until digest; repeat digest is empty', async () => {
        const f = fixture({ notification_frequency: 'DAILY_DIGEST' });
        await f.notifyUsersOfMatchingTors([project, { ...project, project_id: 'P2' }]);
        expect(f.send).not.toHaveBeenCalled();
        expect(f.rows.size).toBe(2);
        await f.sendDailyDigest(); await f.sendDailyDigest();
        expect(f.send).toHaveBeenCalledOnce();
        expect(f.send.mock.calls[0][0].rendered.html).toContain('2 โครงการ');
    });
    it('retry sweep retries failed digest batches without sending a new daily digest early', async () => {
        const f = fixture({ notification_frequency: 'DAILY_DIGEST' });
        await f.notifyUsersOfMatchingTors([project]);
        await f.retryPendingNotifications(); expect(f.send).not.toHaveBeenCalled();
        f.send.mockResolvedValueOnce(null);
        await f.sendDailyDigest();
        f.advance(60001); await f.retryPendingNotifications();
        expect(f.send).toHaveBeenCalledTimes(2);
        expect(f.batches[0].status).toBe('sent');
    });
    it('does not create parallel sends for the same user/project', async () => {
        const f = fixture();
        await Promise.all(Array.from({ length: 5 }, () => f.notifyUsersOfMatchingTors([project])));
        expect(f.send).toHaveBeenCalledOnce(); expect(f.rows.size).toBe(1);
    });
    it('provider failure is bounded, persisted, logged safely and never throws into ingestion', async () => {
        const f = fixture();
        f.send.mockRejectedValue(new Error('private test@example.com re_secret'));
        await expect(f.notifyUsersOfMatchingTors([project])).resolves.toEqual({ notified: 0, skipped: 1 });
        await f.notifyUsersOfMatchingTors([]); expect(f.send).toHaveBeenCalledTimes(1);
        f.advance(60001); await f.notifyUsersOfMatchingTors([]);
        f.advance(120001); await f.notifyUsersOfMatchingTors([]);
        f.advance(180001); await f.notifyUsersOfMatchingTors([project]);
        expect(f.send).toHaveBeenCalledTimes(3);
        expect(f.batches[0].status).toBe('failed');
        expect(new Set(f.send.mock.calls.map(c => c[0].idempotencyKey)).size).toBe(1);
        expect(JSON.stringify(f.log.mock.calls)).not.toMatch(/test@example.com|re_secret/);
        expect(maskNotificationEmail('test@example.com')).toBe('t***@***');
    });
    it('does not retry an ambiguous send beyond provider idempotency retention', async () => {
        const f = fixture(); f.send.mockResolvedValue(null);
        await f.notifyUsersOfMatchingTors([project]); f.advance(24 * 3600000);
        await f.notifyUsersOfMatchingTors([]);
        expect(f.send).toHaveBeenCalledOnce(); expect(f.batches[0].status).toBe('failed');
    });
    it('rechecks disabled preferences and changed recipient before any send', async () => {
        const f = fixture({ notification_frequency: 'DAILY_DIGEST' });
        await f.notifyUsersOfMatchingTors([project]);
        f.users.findById.mockReturnValue({ lean: async () => ({ ...f.user, email_notifications_enabled: false }) });
        await f.sendDailyDigest();
        expect(f.send).not.toHaveBeenCalled(); expect(f.batches[0].status).toBe('cancelled');
    });
    it('database failure never rejects the ingestion hook', async () => {
        const f = fixture(); f.store.enqueue.mockRejectedValue(new Error('db'));
        await expect(f.notifyUsersOfMatchingTors([project])).resolves.toMatchObject({ notified: 0 });
    });
});
