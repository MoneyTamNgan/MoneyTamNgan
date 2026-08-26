import Link from "next/link";

export default function Home() {
  return (
    <main className="auth-page">
      <section className="brand-panel">
        <p className="eyebrow">TOR TRACKING & ANALYSIS</p>
        <h1>ค้นหาโครงการ<br /><em>ที่เหมาะกับคุณ</em></h1>
        <p>ติดตาม TOR สรุปเอกสาร และดูโอกาสโครงการจากข้อมูลจัดซื้อจัดจ้างภาครัฐ</p>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <p className="eyebrow">MONEYTAMNGAN</p>
          <h2>เข้าสู่ระบบ</h2>
          <p>จัดการโปรไฟล์บริษัทและติดตามโครงการที่ตรงกับทักษะของคุณ</p>
          <Link className="primary-button" href="/dashboard">เข้าสู่แดชบอร์ด <span>→</span></Link>
          <Link className="text-link" href="/analytics">ดูข้อมูลวิเคราะห์ย้อนหลัง</Link>
        </div>
      </section>
    </main>
  );
}
