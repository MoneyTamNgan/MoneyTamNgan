import Link from "next/link";
import AppShell from "@/components/ui/AppShell";
import { getMockProject } from "@/lib/mock-projects";

export default async function TorDocumentPage({ params }) {
  const { id } = await params;
  const project = getMockProject(id);
  if (!project) return <AppShell title="ไม่พบเอกสาร"><p className="empty-state">ไม่พบเอกสาร TOR</p></AppShell>;
  return <AppShell title="สรุปเอกสาร TOR">
    <Link className="back-link" href={`/tors/${project.project_id}`}>← กลับไปภาพรวมโครงการ</Link>
    <section className="detail-heading"><p className="eyebrow">DOCUMENT SUMMARY</p><h1>{project.project_name}</h1><p>{project.extracted_data.summary}</p></section>
    <section className="two-column"><article className="content-card"><p className="eyebrow">คุณสมบัติผู้ยื่นข้อเสนอ</p><ul>{project.extracted_data.qualifications.map((item) => <li key={item}>{item}</li>)}</ul></article><article className="content-card"><p className="eyebrow">ขอบเขตงาน</p><ul>{project.extracted_data.scope_of_work.map((item) => <li key={item}>{item}</li>)}</ul></article></section>
    <section className="content-card"><p className="eyebrow">TECH STACK</p><div className="tag-list">{project.extracted_data.tech_stack.map((item) => <span className="tag software" key={item}>{item}</span>)}</div></section>
  </AppShell>;
}
