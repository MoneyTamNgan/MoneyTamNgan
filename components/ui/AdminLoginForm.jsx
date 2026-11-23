'use client';
import { useState } from 'react';
import Link from 'next/link';

function ShieldMark() {
    return (
        <svg className="admin-auth-shield" viewBox="0 0 48 48" aria-hidden="true">
            <path d="M24 4 7 10v13c0 10.5 7.2 18.4 17 21 9.8-2.6 17-10.5 17-21V10L24 4Z" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
            <path d="m16.5 24.5 5 5 10-11" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

// Only ever return to an admin page on this site.
const safeNext = value => (typeof value === 'string' && /^\/admin(\/[A-Za-z0-9_\-/]*)?$/.test(value) ? value : '/admin');

export default function AdminLoginForm({ next = '/admin' }) {
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    const destination = safeNext(next);

    async function submit(event) {
        event.preventDefault();
        if (busy) return;
        const form = new FormData(event.currentTarget);
        setBusy(true); setMessage('');
        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
                body: JSON.stringify({ identifier: String(form.get('identifier') || '').trim(), password: String(form.get('password') || ''), next: destination }),
            });
            if (response.status === 429) { setMessage('ลองหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่'); return; }
            const data = await response.json().catch(() => ({}));
            if (!response.ok) { setMessage(data.error?.message || 'ไม่สามารถเข้าสู่ระบบได้ กรุณาลองใหม่'); return; }
            window.location.assign(data.redirectTo || destination);
        } catch {
            setMessage('ไม่สามารถเชื่อมต่อระบบได้ กรุณาลองใหม่');
        } finally { setBusy(false); }
    }

    return (
        <main className="admin-auth">
            <section className="admin-auth-card" aria-labelledby="admin-auth-title">
                <ShieldMark />
                <p className="admin-auth-eyebrow">BMA TOR TRACKER · ADMIN</p>
                <h1 id="admin-auth-title">ผู้ดูแลระบบ</h1>
                <p className="admin-auth-lead">เฉพาะผู้ที่ได้รับสิทธิ์ ทุกการเข้าถึงถูกบันทึก</p>
                <form onSubmit={submit} aria-busy={busy}>
                    <label htmlFor="admin-identifier">อีเมลหรือชื่อผู้ใช้</label>
                    <input id="admin-identifier" name="identifier" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} required />
                    <label htmlFor="admin-password">รหัสผ่าน</label>
                    <input id="admin-password" name="password" type="password" autoComplete="current-password" required />
                    <button type="submit" disabled={busy}>{busy ? 'กำลังตรวจสอบ…' : 'เข้าสู่ระบบผู้ดูแล'}</button>
                </form>
                {message && <p className="admin-auth-error" role="alert">{message}</p>}
                <Link className="admin-auth-back" href="/">← กลับไปหน้าเข้าสู่ระบบทั่วไป</Link>
            </section>
        </main>
    );
}
