'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminUnlockForm({ next = '/admin' }) {
    const router = useRouter();
    const [code, setCode] = useState('');
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    // Only ever go back to an admin page on this site.
    const destination = typeof next === 'string' && /^\/admin(\/[A-Za-z0-9_\-/]*)?$/.test(next) && next !== '/admin/unlock' ? next : '/admin';

    async function submit(event) {
        event.preventDefault();
        setBusy(true); setMessage('');
        try {
            const response = await fetch('/api/admin/unlock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
            const data = await response.json().catch(() => ({}));
            if (response.ok) { router.replace(destination); router.refresh(); return; }
            setMessage(response.status === 429 ? 'ลองหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่'
                : response.status === 403 && data?.error?.code === 'ADMIN_CODE_INVALID' ? 'รหัสไม่ถูกต้อง'
                    : response.status === 503 ? 'ระบบยังตั้งค่ารหัสผู้ดูแลไม่ถูกต้อง โปรดแจ้งผู้ดูแลระบบ'
                        : 'ไม่สามารถปลดล็อกได้');
        } catch {
            setMessage('เชื่อมต่อไม่ได้ กรุณาลองอีกครั้ง');
        } finally { setBusy(false); }
    }

    return (
        <main className="admin-auth">
            <section className="admin-auth-card" aria-labelledby="admin-unlock-title">
                <svg className="admin-auth-shield" viewBox="0 0 48 48" aria-hidden="true">
                    <rect x="9" y="21" width="30" height="21" rx="4" fill="none" stroke="currentColor" strokeWidth="2.4" />
                    <path d="M15 21v-6a9 9 0 0 1 18 0v6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                    <circle cx="24" cy="31" r="2.6" fill="currentColor" />
                </svg>
                <p className="admin-auth-eyebrow">BMA TOR TRACKER · ADMIN</p>
                <h1 id="admin-unlock-title">ยืนยันรหัสผู้ดูแล</h1>
                <p className="admin-auth-lead">ขั้นตอนยืนยันอีกชั้น การปลดล็อกมีผล 30 นาทีและใช้ได้เฉพาะเครื่องนี้</p>
                <form onSubmit={submit} aria-busy={busy}>
                    <label htmlFor="admin-code">รหัสผู้ดูแล</label>
                    <input id="admin-code" type="password" autoComplete="off" spellCheck={false} maxLength={64} value={code} onChange={e => setCode(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" required />
                    <button type="submit" disabled={busy || !code.trim()}>{busy ? 'กำลังตรวจสอบ…' : 'ปลดล็อก'}</button>
                </form>
                {message && <p className="admin-auth-error" role="alert">{message}</p>}
            </section>
        </main>
    );
}
