import nodemailer from 'nodemailer';

export function emailTransport() {
    const configured = process.env.EMAIL_TRANSPORT;
    if (configured && !['smtp', 'resend'].includes(configured)) throw new Error('Invalid EMAIL_TRANSPORT');
    return configured || (process.env.RESEND_API_KEY ? 'resend' : 'smtp');
}

function smtpTransport() {
    const port = Number(process.env.MAIL_PORT || 1025);
    const encryption = (process.env.MAIL_ENCRYPTION || '').toLowerCase();
    return nodemailer.createTransport({
        host: process.env.MAIL_HOST || 'localhost', port,
        secure: port === 465 || ['ssl', 'smtps'].includes(encryption),
        requireTLS: ['tls', 'starttls'].includes(encryption),
        connectionTimeout: 15000, greetingTimeout: 10000, socketTimeout: 20000,
        logger: false, debug: false,
        disableFileAccess: true, disableUrlAccess: true,
        ...(process.env.MAIL_USERNAME ? { auth: { user: process.env.MAIL_USERNAME, pass: process.env.MAIL_PASSWORD } } : {}),
    });
}

/** Default sender. Override via MAIL_FROM or EMAIL_FROM env var. */
const FROM = process.env.MAIL_FROM || process.env.EMAIL_FROM || 'MoneyTamNgan <notifications@moneytamngan.app>';

/**
 * Low-level send helper.
 * @param {{ to: string, subject: string, html: string }} options
 * @returns {Promise<{ id: string } | null>}
 */
export async function sendEmail({ to, subject, html, from, idempotencyKey, transport = emailTransport() }) {
    try {
        const sender = from || process.env.EMAIL_FROM || process.env.MAIL_FROM || FROM;
        if (transport === 'resend') {
            if (!process.env.RESEND_API_KEY) return null;
            // The SDK logs raw provider errors in development. Use its official REST
            // endpoint so this module controls sanitization in every environment.
            const response = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
                    'Content-Type': 'application/json',
                    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
                },
                body: JSON.stringify({ from: sender, to, subject, html }),
                signal: AbortSignal.timeout(20000),
            });
            if (!response.ok) {
                console.error('[email] Provider rejected notification');
                return null;
            }
            const result = await response.json();
            if (!result.id) return null;
            console.log('[email] Accepted via Resend');
            return { id: result.id };
        }
        const info = await smtpTransport().sendMail({ from: sender, to, subject, html });
        if (!info.accepted?.length) return null;
        console.log('[email] Accepted via SMTP');
        return { id: info.messageId };
    } catch {
        // Provider errors can include addresses, API keys or HTML. Never log the raw error.
        console.error('[email] Notification delivery unavailable');
        return null;
    }
}

export function escapeEmailHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function appBaseUrl() {
    const url = new URL(process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid APP_BASE_URL');
    return url.origin;
}

/**
 * Build and send a TOR match notification email.
 *
 * @param {{
 *   to: string,
 *   userName: string,
 *   matches: Array<{
 *     title: string,
 *     agency: string,
 *     budget: number | null,
 *     matchScore: number,
 *     torId: string,
 *   }>
 * }} options
 */
export function buildMatchNotificationEmail({ to, userName, matches }) {
    const baseUrl = escapeEmailHtml(appBaseUrl());
    userName = escapeEmailHtml(userName || 'คุณ');
    matches = matches.map(match => ({ ...match,
        title: escapeEmailHtml(match.title), agency: escapeEmailHtml(match.agency ?? '-'),
        torId: escapeEmailHtml(encodeURIComponent(String(match.torId))),
        matchScore: Number.isFinite(match.matchScore) ? Math.max(0, Math.min(100, match.matchScore)) : 0,
    }));
    const matchRows = matches
        .map(
            (m) => `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #1e293b;">
            <a href="${baseUrl}/tors/${m.torId}"
               style="color:#6366f1;text-decoration:none;font-weight:600;">${m.title}</a>
          </td>
          <td style="padding:10px 12px;border-bottom:1px solid #1e293b;color:#94a3b8;">${m.agency ?? '-'}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #1e293b;color:#94a3b8;">
            ${m.budget != null ? '฿' + Number(m.budget).toLocaleString('th-TH') : '-'}
          </td>
          <td style="padding:10px 12px;border-bottom:1px solid #1e293b;text-align:center;">
            <span style="
              background:${m.matchScore >= 80 ? '#16a34a' : m.matchScore >= 60 ? '#d97706' : '#dc2626'};
              color:#fff;font-size:13px;font-weight:700;
              padding:3px 10px;border-radius:9999px;">
              ${m.matchScore}%
            </span>
          </td>
        </tr>`
        )
        .join('');

    const html = `
<!DOCTYPE html>
<html lang="th">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:40px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#1e293b;border-radius:16px;overflow:hidden;max-width:600px;width:100%;">
        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:32px 32px 24px;">
            <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">🎯 พบโครงการที่ตรงกับทักษะของคุณ!</h1>
            <p style="margin:8px 0 0;color:#c7d2fe;font-size:14px;">
              สวัสดี ${userName || 'คุณ'}, เราพบ ${matches.length} โครงการที่ตรงกับโปรไฟล์ของคุณ
            </p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:24px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
              <thead>
                <tr style="background:#0f172a;">
                  <th style="padding:10px 12px;text-align:left;color:#94a3b8;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #334155;">ชื่อโครงการ</th>
                  <th style="padding:10px 12px;text-align:left;color:#94a3b8;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #334155;">หน่วยงาน</th>
                  <th style="padding:10px 12px;text-align:left;color:#94a3b8;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #334155;">งบประมาณ</th>
                  <th style="padding:10px 12px;text-align:center;color:#94a3b8;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #334155;">คะแนนความตรง</th>
                </tr>
              </thead>
              <tbody style="color:#e2e8f0;font-size:14px;">
                ${matchRows}
              </tbody>
            </table>
          </td>
        </tr>
        <!-- CTA -->
        <tr>
          <td style="padding:0 32px 32px;" align="center">
            <a href="${baseUrl}"
               style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;
                      text-decoration:none;font-weight:700;font-size:15px;padding:14px 32px;
                      border-radius:10px;margin-top:8px;">
              ดูโครงการทั้งหมด →
            </a>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #334155;text-align:center;">
            <p style="margin:0;color:#475569;font-size:12px;">
              คุณได้รับอีเมลนี้เพราะเปิดใช้งานการแจ้งเตือนใน MoneyTamNgan<br>
              <a href="${baseUrl}/profile"
                 style="color:#6366f1;">จัดการการแจ้งเตือน</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    const count = matches.length;
    const subject = `🎯 พบ ${count} โครงการที่ตรงกับทักษะของคุณ – MoneyTamNgan`;
    return { to, subject, html, transport: emailTransport(), from: process.env.EMAIL_FROM || process.env.MAIL_FROM || FROM };
}

export async function sendMatchNotificationEmail({ rendered, idempotencyKey, ...options }) {
    return sendEmail({ ...(rendered || buildMatchNotificationEmail(options)), idempotencyKey });
}
