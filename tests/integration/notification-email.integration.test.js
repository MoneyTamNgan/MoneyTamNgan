import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { smtpSend, createTransport } = vi.hoisted(() => ({ smtpSend: vi.fn(), createTransport: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport } }));
const send = vi.fn();
afterEach(() => vi.unstubAllGlobals());
const { buildMatchNotificationEmail, sendMatchNotificationEmail } = await import('../../lib/email.js');

beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', send); process.env.EMAIL_TRANSPORT = 'resend'; createTransport.mockReturnValue({ sendMail: smtpSend }); process.env.RESEND_API_KEY = 'mock-key'; process.env.APP_BASE_URL = 'http://localhost:3000'; });
describe('Resend template and transport', () => {
    it('escapes TOR/user HTML, encodes path and supplies settings link and configured origin', async () => {
        process.env.APP_BASE_URL = 'https://example.com';
        const rendered = buildMatchNotificationEmail({ to: 'test@example.com', userName: '<img src=x>',
            matches: [{ torId: 'p/1?x="', title: '<script>alert(1)</script>', agency: 'A&B', matchScore: 75 }] });
        expect(rendered.html).not.toContain('<script>'); expect(rendered.html).not.toContain('<img src=x>');
        expect(rendered.html).toContain('&lt;script&gt;'); expect(rendered.html).toContain('A&amp;B');
        expect(rendered.html).toContain('https://example.com/tors/p%2F1%3Fx%3D%22');
        expect(rendered.html).toContain('https://example.com/profile'); expect(rendered.html).toContain('75%');
        send.mockResolvedValue(new Response(JSON.stringify({ id: 'mail1' }), { status: 200 }));
        expect(await sendMatchNotificationEmail({ rendered, idempotencyKey: 'tor-match/b1' })).toEqual({ id: 'mail1' });
        expect(send).toHaveBeenCalledWith('https://api.resend.com/emails', expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'Idempotency-Key': 'tor-match/b1' }) }));
        const { transport, ...providerPayload } = rendered;
        expect(JSON.parse(send.mock.calls[0][1].body)).toEqual(providerPayload);
    });
    it('does not expose raw Resend errors containing email or credentials', async () => {
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        send.mockResolvedValue(new Response(JSON.stringify({ message: 'test@example.com mock-key' }), { status: 403 }));
        expect(await sendMatchNotificationEmail({ rendered: { to: 'test@example.com' } })).toBeNull();
        expect(JSON.stringify(log.mock.calls)).not.toMatch(/test@example.com|mock-key/); log.mockRestore();
    });
    it('explicit SMTP bypasses Resend and uses authenticated TLS settings', async () => {
        process.env.EMAIL_TRANSPORT = 'smtp';
        process.env.MAIL_HOST = 'smtp.example.com'; process.env.MAIL_PORT = '587';
        process.env.MAIL_ENCRYPTION = 'tls'; process.env.MAIL_USERNAME = 'user'; process.env.MAIL_PASSWORD = 'mock-password';
        smtpSend.mockResolvedValue({ messageId: 'smtp1', accepted: ['test@example.com'] });
        expect(await sendMatchNotificationEmail({ rendered: { to: 'test@example.com', transport: 'smtp' } })).toEqual({ id: 'smtp1' });
        expect(send).not.toHaveBeenCalled();
        expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: 'smtp.example.com', port: 587,
            secure: false, requireTLS: true, auth: { user: 'user', pass: 'mock-password' }, logger: false, debug: false }));
    });
    it('SMTP rejection logs no address or password', async () => {
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        smtpSend.mockRejectedValue(new Error('test@example.com mock-password'));
        expect(await sendMatchNotificationEmail({ rendered: { to: 'test@example.com', transport: 'smtp' } })).toBeNull();
        expect(JSON.stringify(log.mock.calls)).not.toMatch(/test@example.com|mock-password/); log.mockRestore();
    });
});
