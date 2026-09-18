import Link from "next/link";
import AppShell from "@/components/ui/AppShell";
import { getProjectRecord } from "@/lib/services/tor-service";

export default async function TorDocumentPage({ params }) {
  const { id } = await params;
  const project = await getProjectRecord(id);
  if (!project) return <AppShell title="ไม่พบเอกสาร"><p className="empty-state">ไม่พบเอกสาร TOR</p></AppShell>;
  const hasExtractedData = Boolean(project.extracted_data.summary || project.extracted_data.qualifications.length || project.extracted_data.scope_of_work.length || project.extracted_data.tech_stack.length);
  if (!hasExtractedData) return <AppShell title="สรุปเอกสาร TOR"><Link className="back-link" href={`/tors/${project.project_id}`}>← กลับไปภาพรวมโครงการ</Link><section className="content-card"><p className="eyebrow">สถานะเอกสาร</p><h2>รอข้อมูลจากเอกสาร TOR</h2><p>{project.pdf_url ? "พบเอกสาร PDF แล้ว แต่ยังไม่มีข้อมูลที่สกัดจากเอกสาร" : "ยังไม่มีเอกสาร PDF สำหรับโครงการนี้"}</p></section></AppShell>;
  return <AppShell title="สรุปเอกสาร TOR">
    <Link className="back-link" href={`/tors/${project.project_id}`}>← กลับไปภาพรวมโครงการ</Link>
    <section className="detail-heading"><p className="eyebrow">สรุปข้อมูลที่สกัดจากเอกสาร</p><h1>{project.project_name}</h1><p>{project.extracted_data.summary || "ยังไม่มีข้อมูลสรุปจากเอกสาร"}</p></section>
    <section className="two-column"><article className="content-card"><p className="eyebrow">คุณสมบัติผู้ยื่นข้อเสนอ</p>{project.extracted_data.qualifications.length ? <ul>{project.extracted_data.qualifications.map((item) => <li key={item}>{item}</li>)}</ul> : <p>ยังไม่มีข้อมูลคุณสมบัติ</p>}</article><article className="content-card"><p className="eyebrow">ขอบเขตงาน</p>{project.extracted_data.scope_of_work.length ? <ul>{project.extracted_data.scope_of_work.map((item) => <li key={item}>{item}</li>)}</ul> : <p>ยังไม่มีข้อมูลขอบเขตงาน</p>}</article></section>
    <section className="content-card"><p className="eyebrow">เทคโนโลยีที่สกัดได้</p>{project.extracted_data.tech_stack.length ? <div className="tag-list">{project.extracted_data.tech_stack.map((item) => <span className="tag software" key={item}>{item}</span>)}</div> : <p>ยังไม่มีข้อมูลเทคโนโลยี</p>}</section>
  </AppShell>;
}
