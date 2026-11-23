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
        <form className="bid-card bid-hero" onSubmit={submit} aria-busy={busy}>
            <p className="bid-hero-eyebrow">ผู้ดูแลระบบ</p>
            <h2>ใส่รหัสผู้ดูแลเพื่อเข้าใช้งาน</h2>
            <p className="bid-hero-lead">บัญชีนี้เป็นผู้ดูแลระบบแล้ว ขั้นตอนนี้ยืนยันอีกชั้น การปลดล็อกมีผล 30 นาทีและใช้ได้เฉพาะเครื่องนี้</p>
            <label htmlFor="admin-code">รหัสผู้ดูแล</label>
            <input id="admin-code" type="password" autoComplete="off" spellCheck={false} maxLength={64} value={code} onChange={e => setCode(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" />
            <div className="bid-actions">
                <button className="bid-primary bid-cta" type="submit" disabled={busy || !code.trim()}>ปลดล็อก</button>
            </div>
            {message && <p className="bid-error" role="alert">{message}</p>}
        </form>
    );
}
