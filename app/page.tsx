"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import AuthWaitDialog from '@/components/AuthWaitDialog';

function GoogleMark() {
  return <svg aria-hidden="true" className="google-mark" viewBox="0 0 24 24"><path fill="#4285F4" d="M21.8 12.23c0-.71-.06-1.2-.2-1.72H12v3.38h5.64c-.11.84-.72 2.1-2.08 2.95l-.02.11 3.02 2.29.21.02c1.92-1.73 3.03-4.28 3.03-7.33Z" /><path fill="#34A853" d="M12 21.95c2.76 0 5.08-.89 6.77-2.42l-3.22-2.42c-.86.59-2.02 1-3.55 1-2.7 0-4.99-1.74-5.81-4.15l-.1.01-3.14 2.38-.03.09C4.6 19.7 8.04 21.95 12 21.95Z" /><path fill="#FBBC05" d="M6.19 13.96A5.9 5.9 0 0 1 5.86 12c0-.68.12-1.33.32-1.96l-.01-.13L3 7.5l-.1.05A9.73 9.73 0 0 0 2 12c0 1.61.39 3.14.9 4.45l3.29-2.49Z" /><path fill="#EA4335" d="M12 5.89c1.93 0 3.23.82 3.97 1.5l2.9-2.78C17.07 2.98 14.76 2 12 2 8.04 2 4.6 4.25 2.9 7.55l3.29 2.49C7.01 7.63 9.3 5.89 12 5.89Z" /></svg>;
}

function BmaSeal() {
  return <div className="seal" aria-label="ตราสัญลักษณ์กรุงเทพมหานคร" role="img"><svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="29" fill="none" stroke="currentColor" strokeWidth="1.5" /><circle cx="32" cy="32" r="22" fill="none" stroke="currentColor" strokeWidth="1" opacity=".8" /><path d="M20 38h24M23 38V27l9-7 9 7v11M28 38v-8h8v8M18 17h28" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /><text x="32" y="52" textAnchor="middle" fontSize="6.5" fontWeight="700">BMA</text></svg></div>;
}

export default function Home() {
  const [notice, setNotice] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [pending, setPending] = useState(false);
  const [waitUntil, setWaitUntil] = useState(0);
  const [showWait, setShowWait] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    const returnedUntil = Number(url.searchParams.get('auth_wait_until'));
    if (returnedUntil > Date.now() && returnedUntil <= Date.now() + 15 * 60 * 1000) {
      setWaitUntil(returnedUntil); setShowWait(true);
      try { sessionStorage.setItem('auth-wait-until', String(returnedUntil)); } catch { /* optional */ }
    }
    if (url.searchParams.has('auth_wait_until')) {
      url.searchParams.delete('auth_wait_until');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
    try {
      const until = Number(sessionStorage.getItem('auth-wait-until'));
      if (until > Date.now()) { setWaitUntil(until); setShowWait(true); }
    } catch { /* Storage may be disabled; the server still enforces the limit. */ }
  }, []);

  function showRateLimit(response: Response) {
    const value = response.headers.get('Retry-After');
    const seconds = value && /^\d+$/.test(value) ? Number(value) : NaN;
    const until = Number.isFinite(seconds) ? Date.now() + seconds * 1000 : Date.parse(value || '');
    const deadline = Number.isFinite(until) && until > Date.now() ? until : Date.now() + 60000;
    setWaitUntil(deadline); setShowWait(true);
    try { sessionStorage.setItem('auth-wait-until', String(deadline)); } catch { /* optional */ }
  }

  function stillWaiting() {
    if (waitUntil > Date.now()) { setShowWait(true); return true; }
    return false;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (stillWaiting()) return;
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") || "");
    if (mode === "register" && password !== form.get("confirmPassword")) {
      setNotice("รหัสผ่านทั้งสองช่องไม่ตรงกัน"); return;
    }
    setPending(true); setNotice("");
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({
          ...(mode === "login"
            ? { identifier: String(form.get("identifier") || "").trim() }
            : { email: form.get("email"), username: String(form.get("username") || "").trim() || undefined }),
          password, next: new URLSearchParams(window.location.search).get("next") }),
      });
      if (response.status === 429) { showRateLimit(response); return; }
      const data = await response.json();
      if (!response.ok) { setNotice(data.error?.message || "ไม่สามารถเข้าสู่ระบบได้ กรุณาลองใหม่"); return; }
      // API supplies a validated same-origin path; use a full navigation so
      // server components and the shared auth UI see the new session cookie.
      window.location.assign(data.redirectTo || "/dashboard");
    } catch { setNotice("ไม่สามารถเชื่อมต่อระบบได้ กรุณาลองใหม่"); }
    finally { setPending(false); }
  }

  function signInWithGoogle() {
    if (pending || stillWaiting()) return;
    setPending(true); setNotice('');
    const next = new URLSearchParams(window.location.search).get("next");
    // OAuth is a top-level navigation. A blocked HTML request returns HTTP 429
    // and takes the browser back here with the server's countdown deadline.
    window.location.assign('/api/auth/google/start' + (next ? `?next=${encodeURIComponent(next)}` : ''));
  }

  return <main className="auth-page">
    {showWait && <AuthWaitDialog until={waitUntil} onClose={() => setShowWait(false)} />}
    <div className="city-grid" aria-hidden="true" />
    <section className="brand-panel" aria-label="BMA TOR TRACKER">
      <div className="brand-lockup"><BmaSeal /><span className="brand-name">BMA TOR<br />TRACKER</span></div>
      <div className="brand-copy"><p className="eyebrow">กรุงเทพมหานคร · ข้อมูลจัดซื้อจัดจ้างด้านเทคโนโลยี</p><h1>ค้นหา TOR เทคโนโลยี<br /><em>ให้พบโอกาสที่ใช่สำหรับคุณ</em></h1><p>รวม TOR ด้านซอฟต์แวร์ วิเคราะห์เอกสาร PDF สรุปคุณสมบัติ เปรียบเทียบงบประมาณ และค้นหาโครงการที่ตรงกับศักยภาพของคุณ</p></div>
      <p className="brand-footer">ข้อมูลสาธารณะ · กรุงเทพมหานคร</p>
    </section>
    <section className="login-area">
      <div className="login-card">
        <header className="login-header"><div className="mobile-seal"><BmaSeal /></div><p className="section-label">ศูนย์วิเคราะห์ TOR โครงการเทคโนโลยี</p><h2>{mode === "register" ? "สร้างบัญชี" : "เข้าสู่ระบบ"}</h2><p>ติดตามโครงการที่ตรงกับทักษะและความสนใจของคุณ</p></header>
        <button className="google-button" type="button" onClick={signInWithGoogle}><GoogleMark /><span>เข้าสู่ระบบด้วย Google</span></button>
        <div className="divider"><span>หรือ{mode === "register" ? "สร้างบัญชี" : "เข้าสู่ระบบ"}ด้วยอีเมล{mode === "login" ? " หรือชื่อผู้ใช้" : ""}</span></div>
        <form key={mode} onSubmit={handleSubmit} aria-busy={pending}>
          {mode === "login"
            ? <><label htmlFor="identifier">อีเมลหรือชื่อผู้ใช้</label><input id="identifier" name="identifier" type="text" placeholder="name@example.com หรือ username" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={254} required /></>
            : <><label htmlFor="email">อีเมล</label><input id="email" name="email" type="email" placeholder="name@example.com" autoComplete="email" maxLength={254} required />
              <label htmlFor="username">ชื่อผู้ใช้ (ไม่บังคับ)</label><input id="username" name="username" type="text" placeholder="เช่น somchai.s" autoComplete="off" autoCapitalize="none" spellCheck={false} minLength={3} maxLength={30} pattern="[A-Za-z0-9][A-Za-z0-9._\-]{1,28}[A-Za-z0-9]" title="3–30 ตัวอักษร ใช้ a-z 0-9 . _ - และต้องขึ้นต้น/ลงท้ายด้วยตัวอักษรหรือตัวเลข" />
              <p className="password-hint">ไม่ใส่ก็ได้ ระบบจะสร้างให้จากอีเมล</p></>}
          <label htmlFor="password">รหัสผ่าน</label><div className="password-wrap"><input id="password" name="password" type="password" placeholder="รหัสผ่านอย่างน้อย 15 ตัวอักษร" autoComplete={mode === "register" ? "new-password" : "current-password"} minLength={15} maxLength={128} required /></div>
          {mode === "register" && <><p className="password-hint">ใช้รหัสผ่าน 15–128 ตัวอักษร เช่น วลีที่จำง่าย</p><label htmlFor="confirmPassword">ยืนยันรหัสผ่าน</label><input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" minLength={15} maxLength={128} required /></>}
          <button className="sign-in" type="submit" disabled={pending}>{pending ? "กำลังดำเนินการ…" : mode === "register" ? "สร้างบัญชี" : "เข้าสู่ระบบ"} <span aria-hidden="true">→</span></button>
        </form>
        {notice && <p className="notice" role="alert">{notice}</p>}
        <p className="auth-switch">{mode === "register" ? "มีบัญชีอยู่แล้ว? " : "ยังไม่มีบัญชี? "}<button type="button" className="text-button" disabled={pending} onClick={() => { setMode(mode === "login" ? "register" : "login"); setNotice(""); }}>{mode === "register" ? "เข้าสู่ระบบ" : "สร้างบัญชี"}</button></p>
        <Link className="guest-link" href="/analytics"><span className="globe" aria-hidden="true">◎</span>ดูข้อมูลวิเคราะห์ย้อนหลัง <small>(ไม่ต้องเข้าสู่ระบบ)</small></Link>
      </div>
      <p className="support">ต้องการความช่วยเหลือ? <a href="mailto:tor.analytics@bangkok.go.th">ติดต่อผู้ดูแลระบบ</a></p>
    </section>
  </main>;
}
