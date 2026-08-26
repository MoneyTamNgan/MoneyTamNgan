import Link from "next/link";
import AppShell from "@/components/ui/AppShell";
import { getMockProject } from "@/lib/mock-projects";

export default async function TorOverviewPage({ params }) {
  const { id } = await params;
  const project = getMockProject(id);
  if (!project) return <AppShell title="ไม่พบโครงการ"><p className="empty-state">ไม่พบ TOR ที่ต้องการ</p></AppShell>;
  return <AppShell title="ภาพรวม TOR">
    <Link className="back-link" href="/dashboard">← กลับไปยังรายการ TOR</Link>
    <section className="detail-heading"><p className="eyebrow">TOR · {project.dept_name}</p><h1>{project.project_name}</h1><div className="heading-actions"><span className={project.is_software ? "tag software" : "tag"}>{project.is_software ? "โครงการซอฟต์แวร์ / ไอที" : "นอกขอบเขตซอฟต์แวร์"}</span><Link className="primary-button" href={`/tors/${project.project_id}/document`}>ดูสรุปเอกสาร →</Link></div></section>
    <section className="facts-grid"><div><span>หน่วยงาน</span><strong>{project.dept_name}</strong></div><div><span>งบประมาณ</span><strong>{project.budget.toLocaleString("th-TH")} บาท</strong></div><div><span>สถานะ</span><strong>{project.project_status}</strong></div><div><span>วันประกาศ</span><strong>{project.timeline.announce_date}</strong></div></section>
    <section className="content-card"><p className="eyebrow">AI SUMMARY</p><h2>ภาพรวมโครงการ</h2><p>{project.extracted_data.summary}</p></section>
  </AppShell>;
}
