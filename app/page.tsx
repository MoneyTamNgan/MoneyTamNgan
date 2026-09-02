"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

function GoogleMark() {
  return <svg aria-hidden="true" className="google-mark" viewBox="0 0 24 24"><path fill="#4285F4" d="M21.8 12.23c0-.71-.06-1.2-.2-1.72H12v3.38h5.64c-.11.84-.72 2.1-2.08 2.95l-.02.11 3.02 2.29.21.02c1.92-1.73 3.03-4.28 3.03-7.33Z" /><path fill="#34A853" d="M12 21.95c2.76 0 5.08-.89 6.77-2.42l-3.22-2.42c-.86.59-2.02 1-3.55 1-2.7 0-4.99-1.74-5.81-4.15l-.1.01-3.14 2.38-.03.09C4.6 19.7 8.04 21.95 12 21.95Z" /><path fill="#FBBC05" d="M6.19 13.96A5.9 5.9 0 0 1 5.86 12c0-.68.12-1.33.32-1.96l-.01-.13L3 7.5l-.1.05A9.73 9.73 0 0 0 2 12c0 1.61.39 3.14.9 4.45l3.29-2.49Z" /><path fill="#EA4335" d="M12 5.89c1.93 0 3.23.82 3.97 1.5l2.9-2.78C17.07 2.98 14.76 2 12 2 8.04 2 4.6 4.25 2.9 7.55l3.29 2.49C7.01 7.63 9.3 5.89 12 5.89Z" /></svg>;
}

function BmaSeal() {
  return <div className="seal" aria-label="ตราสัญลักษณ์กรุงเทพมหานคร" role="img"><svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="29" fill="none" stroke="currentColor" strokeWidth="1.5" /><circle cx="32" cy="32" r="22" fill="none" stroke="currentColor" strokeWidth="1" opacity=".8" /><path d="M20 38h24M23 38V27l9-7 9 7v11M28 38v-8h8v8M18 17h28" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /><text x="32" y="52" textAnchor="middle" fontSize="6.5" fontWeight="700">BMA</text></svg></div>;
}

export default function Home() {
  const router = useRouter();
  const [notice, setNotice] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("โหมดสาธิต: ระบบพร้อมเชื่อมต่อการยืนยันตัวตนจริง");
  }

  return <main className="auth-page">
    <div className="city-grid" aria-hidden="true" />
    <section className="brand-panel" aria-label="BMA TOR TRACKER">
      <div className="brand-lockup"><BmaSeal /><span className="brand-name">BMA TOR<br />TRACKER</span></div>
      <div className="brand-copy"><p className="eyebrow">กรุงเทพมหานคร · ข้อมูลจัดซื้อจัดจ้างด้านเทคโนโลยี</p><h1>ค้นหา TOR เทคโนโลยี<br /><em>ให้พบโอกาสที่ใช่สำหรับคุณ</em></h1><p>รวม TOR ด้านซอฟต์แวร์ วิเคราะห์เอกสาร PDF สรุปคุณสมบัติ เปรียบเทียบงบประมาณ และค้นหาโครงการที่ตรงกับศักยภาพของคุณ</p></div>
      <p className="brand-footer">ข้อมูลสาธารณะ · กรุงเทพมหานคร</p>
    </section>
    <section className="login-area">
      <div className="login-card">
        <header className="login-header"><div className="mobile-seal"><BmaSeal /></div><p className="section-label">ศูนย์วิเคราะห์ TOR โครงการเทคโนโลยี</p><h2>เข้าสู่ระบบ</h2><p>ติดตามโครงการที่ตรงกับทักษะและความสนใจของคุณ</p></header>
        <button className="google-button" type="button" onClick={() => router.push("/dashboard")}><GoogleMark /><span>เข้าสู่ระบบด้วย Google</span></button>
        <div className="divider"><span>หรือเข้าสู่ระบบด้วยอีเมล</span></div>
        <form onSubmit={handleSubmit}>
          <label htmlFor="email">อีเมลหน่วยงาน</label><input id="email" type="email" placeholder="name@bangkok.go.th" autoComplete="email" required />
          <label htmlFor="password">รหัสผ่าน</label><div className="password-wrap"><input id="password" type="password" placeholder="กรอกรหัสผ่าน" autoComplete="current-password" required /><span aria-hidden="true">•••</span></div>
          <div className="form-options"><label className="remember"><input type="checkbox" /> <span>จดจำการเข้าสู่ระบบ</span></label><button type="button" className="text-button">ลืมรหัสผ่าน?</button></div>
          <button className="sign-in" type="submit">เข้าสู่ระบบ <span aria-hidden="true">→</span></button>
        </form>
        {notice && <p className="notice" role="status">{notice}</p>}
        <Link className="guest-link" href="/analytics"><span className="globe" aria-hidden="true">◎</span>ดูข้อมูลวิเคราะห์ย้อนหลัง <small>(ไม่ต้องเข้าสู่ระบบ)</small></Link>
      </div>
      <p className="support">ต้องการความช่วยเหลือ? <a href="mailto:tor.analytics@bangkok.go.th">ติดต่อผู้ดูแลระบบ</a></p>
    </section>
  </main>;
}
