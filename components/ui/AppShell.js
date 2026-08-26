import Link from "next/link";

export default function AppShell({ title, children }) {
  return <main className="app-shell"><header className="top-nav"><Link className="brand" href="/dashboard"><span className="brand-mark">MT</span><span>MoneyTamNgan<br /><strong>TOR TRACKER</strong></span></Link><nav><Link href="/dashboard">โครงการ</Link><Link href="/analytics">วิเคราะห์ข้อมูล</Link><Link href="/profile">โปรไฟล์</Link><Link href="/admin">ผู้ดูแล</Link></nav></header><div className="page-container"><p className="page-label">{title}</p>{children}</div></main>;
}
