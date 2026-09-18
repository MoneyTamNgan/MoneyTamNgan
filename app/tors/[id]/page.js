import Link from "next/link";
import AppShell from "@/components/ui/AppShell";
import { getProjectRecord } from "@/lib/services/tor-service";

const statusLabels = { Active: "กำลังใช้งาน", Superseded: "มีฉบับใหม่", Invalid: "ไม่ถูกต้อง", Cancelled: "ยกเลิก" };

function valueOrUnknown(value) {
  return value || "ยังไม่มีข้อมูล";
}

function thaiDate(value) {
  if (!value) return "ยังไม่มีข้อมูล";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "ยังไม่มีข้อมูล" : new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

export default async function TorOverviewPage({ params }) {
  const { id } = await params;
  const project = await getProjectRecord(id);
  if (!project) return <AppShell title="ไม่พบโครงการ"><p className="empty-state">ไม่พบ TOR ที่ต้องการ</p></AppShell>;
  const hasExtractedDocument = Boolean(project.pdf_url && (project.extracted_data.summary || project.extracted_data.qualifications.length || project.extracted_data.scope_of_work.length || project.extracted_data.tech_stack.length));
  const versionStatus = project.version_info.is_latest ? `ฉบับล่าสุด · เวอร์ชัน ${project.version_info.version}` : `มีฉบับใหม่ · เวอร์ชัน ${project.version_info.version}`;
  const qualificationItems = project.extracted_data.qualifications;
  const hasAnomaly = project.anomalies.high_budget_flag || project.anomalies.flagged_clauses.length > 0;

  return <AppShell title="ภาพรวม TOR" hideTitle><div className="tor-overview-layout"><aside className="tor-overview-side"><p>ภาพรวม TOR</p><div className="tor-overview-utility"><Link className="tor-home-button" href="/dashboard">← กลับสู่หน้าแรก</Link>{project.pdf_url && <a className="tor-header-pdf" href={project.pdf_url} target="_blank" rel="noreferrer">เปิด PDF ต้นฉบับ ↗</a>}</div></aside><div className="tor-overview">
    <header className="tor-overview-header"><div><p className="tor-overview-id">รหัสโครงการ {project.project_id}</p><h1>{project.project_name}</h1><p className="tor-overview-agency">{project.dept_name}{project.dept_sub_name ? ` · ${project.dept_sub_name}` : ""}</p><div className="tor-overview-actions"><span className={project.is_software ? "tor-classification is-software" : "tor-classification"}>{project.is_software ? "โครงการซอฟต์แวร์ / ไอที" : "นอกขอบเขตซอฟต์แวร์"}</span><span className={hasExtractedDocument ? "tor-ai-badge" : "tor-ai-badge is-pending"}>{hasExtractedDocument ? "มีข้อมูลสกัดจากเอกสาร" : "รอข้อมูลจากเอกสาร"}</span></div></div></header>
    <section className="tor-lifecycle" aria-label="สถานะเอกสารและวงจรโครงการ"><div><span>ประเภทโครงการ</span><strong>{project.is_software ? "ซอฟต์แวร์ / ไอที" : "นอกขอบเขตซอฟต์แวร์"}</strong></div><div><span>การดึงข้อมูล PDF</span><strong>{hasExtractedDocument ? "ประมวลผลแล้ว" : project.pdf_url ? "รอประมวลผล" : "ยังไม่มีเอกสาร"}</strong></div><div><span>เวอร์ชัน / วงจรโครงการ</span><strong>{versionStatus}</strong>{project.version_info.superseded_by && <Link href={`/tors/${project.version_info.superseded_by}`}>ไปยังฉบับใหม่ →</Link>}</div></section>
    <section className="tor-metrics" aria-label="ข้อมูลสำคัญโครงการ"><article><span>งบประมาณ</span><strong>{project.budget.toLocaleString("th-TH")} บาท</strong></article><article><span>วันประกาศ</span><strong>{thaiDate(project.timeline.announce_date)}</strong></article><article><span>สถานะโครงการ</span><strong>{statusLabels[project.project_status] ?? valueOrUnknown(project.project_status)}</strong></article></section>
    <section className="tor-detail-grid"><article className="tor-detail-card"><p className="tor-section-kicker">ข้อมูลโครงการ</p><h2>รายละเอียดที่จัดเก็บ</h2><dl><div><dt>หน่วยงาน</dt><dd>{project.dept_name}</dd></div><div><dt>หน่วยงานย่อย / ฝ่าย</dt><dd>{valueOrUnknown(project.dept_sub_name)}</dd></div><div><dt>วันเริ่มสัญญา</dt><dd>{thaiDate(project.timeline.contract_start)}</dd></div><div><dt>วันสิ้นสุดสัญญา</dt><dd>{thaiDate(project.timeline.contract_end)}</dd></div><div><dt>ระยะเวลาดำเนินการ</dt><dd>{project.timeline.duration_days ? `${project.timeline.duration_days.toLocaleString("th-TH")} วัน` : "ยังไม่มีข้อมูล"}</dd></div><div><dt>บันทึกข้อมูลเมื่อ</dt><dd>{thaiDate(project.created_at)}</dd></div><div><dt>ปรับปรุงข้อมูลเมื่อ</dt><dd>{thaiDate(project.updated_at)}</dd></div><div><dt>เอกสาร PDF ต้นฉบับ</dt><dd>{project.pdf_url ? <a href={project.pdf_url} target="_blank" rel="noreferrer">เปิดเอกสาร ↗</a> : "ยังไม่มีข้อมูล"}</dd></div></dl></article><article className="tor-detail-card tor-qualification-card"><p className="tor-section-kicker">เปรียบเทียบคุณสมบัติ</p><h2>คุณสมบัติผู้ยื่นข้อเสนอ</h2>{qualificationItems.length ? <ul className="qualification-list">{qualificationItems.map((item) => <li key={item}><p>{item}</p><span>รอข้อมูลโปรไฟล์บริษัท</span></li>)}</ul> : <div className="tor-pending-state"><strong>{project.pdf_url ? "รอประมวลผลเอกสาร" : "ยังไม่มีเอกสาร TOR"}</strong><p>ยังไม่มีข้อมูลคุณสมบัติที่สกัดจากเอกสาร จึงไม่สามารถเปรียบเทียบกับโปรไฟล์บริษัทได้</p></div>}</article></section>
    <section className="tor-anomaly-card"><p className="tor-section-kicker">ข้อมูลตรวจสอบ</p><h2>ข้อสังเกตจากเอกสาร</h2>{hasAnomaly ? <>{project.anomalies.high_budget_flag && <p className="tor-anomaly-budget">งบประมาณมีข้อสังเกตเมื่อเทียบกับข้อมูลที่มี{project.anomalies.budget_deviation_multiplier > 0 ? ` (${project.anomalies.budget_deviation_multiplier.toLocaleString("th-TH")} เท่า)` : ""}</p>}{project.anomalies.flagged_clauses.length ? <ul>{project.anomalies.flagged_clauses.map((clause) => <li key={clause.clause_text}><strong>{clause.clause_text}</strong><span>{clause.reason}</span></li>)}</ul> : null}</> : <p>ยังไม่พบข้อสังเกตจากข้อมูลที่จัดเก็บ</p>}</section>
    <section className="tor-extracted-data"><article className="tor-summary-card"><p className="tor-section-kicker">สรุปจากเอกสาร</p><h2>ภาพรวมโครงการ</h2><p>{project.extracted_data.summary || "ยังไม่มีข้อมูลสรุปจากเอกสาร"}</p></article><article className="tor-summary-card"><p className="tor-section-kicker">ขอบเขตและเทคโนโลยี</p><h2>ข้อมูลที่สกัดได้</h2>{project.extracted_data.scope_of_work.length ? <ul>{project.extracted_data.scope_of_work.map((item) => <li key={item}>{item}</li>)}</ul> : <p>ยังไม่มีข้อมูลขอบเขตงาน</p>}{project.extracted_data.tech_stack.length ? <div className="tor-tech-tags">{project.extracted_data.tech_stack.map((item) => <span key={item}>{item}</span>)}</div> : <p>ยังไม่มีข้อมูลเทคโนโลยี</p>}</article></section>
  </div></div></AppShell>;
}
