import nodemailer from 'nodemailer';
import { Resend } from 'resend';

const resendClient = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

/** SMTP transporter using MailHog (or any SMTP provider via env vars) */
const transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST || 'localhost',
    port: parseInt(process.env.MAIL_PORT || '1025', 10),
    secure: process.env.MAIL_ENCRYPTION === 'ssl',
    auth:
        process.env.MAIL_USERNAME
            ? {
                  user: process.env.MAIL_USERNAME,
                  pass: process.env.MAIL_PASSWORD,
              }
            : undefined,
});

/** Default sender. Override via MAIL_FROM or EMAIL_FROM env var. */
const FROM = process.env.MAIL_FROM || process.env.EMAIL_FROM || 'MoneyTamNgan <notifications@moneytamngan.app>';

/**
 * Low-level send helper.
 * @param {{ to: string, subject: string, html: string }} options
 * @returns {Promise<{ id: string } | null>}
 */
export async function sendEmail({ to, subject, html }) {
    try {
        if (resendClient) {
            const response = await resendClient.emails.send({
                from: FROM,
                to,
                subject,
                html,
            });
            if (response.error) {
                console.error('[email] Resend error:', response.error);
                return null;
            }
            const id = response.data?.id || 'resend-sent';
            console.log('[email] Sent via Resend:', id);
            return { id };
        }

        const info = await transporter.sendMail({ from: FROM, to, subject, html });
        console.log('[email] Sent via SMTP:', info.messageId);
        return { id: info.messageId };
    } catch (err) {
        console.error('[email] Unexpected error sending email:', err);
        return null;
    }
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
export async function sendMatchNotificationEmail({ to, userName, matches }) {
    const matchRows = matches
        .map(
            (m) => `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #1e293b;">
            <a href="${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/tors/${m.torId}"
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
            <a href="${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}"
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
              <a href="${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/profile"
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
    return sendEmail({ to, subject, html });
}
