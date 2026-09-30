import Link from "next/link";
import { headers } from "next/headers";
import AppShell from "@/components/ui/AppShell";
import AdditionalInfoCard from "@/components/ui/AdditionalInfoCard";
import BidderQualificationCard from "@/components/ui/BidderQualificationCard";
import DocumentObservationsCard from "@/components/ui/DocumentObservationsCard";
import TechStackComparisonCard from "@/components/ui/TechStackComparisonCard";
import { getTorDetail } from "@/lib/services/tor-service";

const statusLabels = { Active: "กำลังใช้งาน", Superseded: "มีฉบับใหม่", Invalid: "ไม่ถูกต้อง", Cancelled: "ยกเลิก" };

function valueOrUnknown(value) {
  return value || "ยังไม่มีข้อมูล";
}

function thaiDate(value) {
  if (!value) return "ยังไม่มีข้อมูล";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "ยังไม่มีข้อมูล" : new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

function detailToProjectRecord(tor) {
  const highBudgetAnomaly = tor.anomalies.find((anomaly) => anomaly.type === "high_budget");
  const flaggedClauses = tor.anomalies
    .filter((anomaly) => anomaly.type === "flagged_clause")
    .map((anomaly) => ({ clause_text: anomaly.clauseText, reason: anomaly.reason }));

  return {
    project_id: tor.id,
    project_name: tor.title,
    dept_name: tor.agency.name,
    dept_sub_name: tor.agency.subName ?? undefined,
    budget: tor.budget,
    project_status: tor.projectStatus,
    is_software: tor.classification.isSoftware,
    timeline: {
      announce_date: tor.timeline.announceDate,
      contract_start: tor.timeline.contractStart,
      contract_end: tor.timeline.contractEnd,
      duration_days: tor.timeline.durationDays ?? undefined,
    },
    pdf_url: tor.pdfUrl ?? undefined,
    document: { status: tor.documentStatus ?? undefined },
    processing: { status: tor.processingStatus ?? undefined },
    extracted_data: {
      summary: tor.summary,
      qualifications: tor.requirements,
      scope_of_work: tor.scopeOfWork,
      tech_stack: tor.techStack,
    },
    anomalies: {
      high_budget_flag: Boolean(highBudgetAnomaly),
      budget_deviation_multiplier: highBudgetAnomaly?.type === "high_budget" ? highBudgetAnomaly.budgetDeviationMultiplier : 1,
      flagged_clauses: flaggedClauses,
    },
    version_info: {
      version: tor.version.number,
      is_latest: tor.version.isLatest,
      superseded_by: tor.version.supersededBy,
    },
    created_at: tor.createdAt ?? undefined,
    updated_at: tor.updatedAt ?? undefined,
  };
}

function getApiOrigin(requestHeaders) {
  const configuredOrigin = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (configuredOrigin) return configuredOrigin.replace(/\/$/, "");

  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (!host) throw new Error("Cannot determine the TOR API origin");
  const protocol = (requestHeaders.get("x-forwarded-proto") ?? "http").split(",")[0];
  return `${protocol}://${host}`;
}

export default async function TorOverviewPage({ params }) {
  const { id } = await params;
  const tor = await getTorDetail(id, getApiOrigin(await headers()));
  const project = tor ? detailToProjectRecord(tor) : null;
  if (!project) return <AppShell title="ไม่พบโครงการ"><p className="empty-state">ไม่พบ TOR ที่ต้องการ</p></AppShell>;
  const hasExtractedDocument = Boolean(project.extracted_data.summary || project.extracted_data.qualifications.length || project.extracted_data.scope_of_work.length || project.extracted_data.tech_stack.length);
  const hasDocument = Boolean(project.document?.status && project.document.status !== "unavailable");
  const versionStatus = project.version_info.is_latest ? `ฉบับล่าสุด · เวอร์ชัน ${project.version_info.version}` : `มีฉบับใหม่ · เวอร์ชัน ${project.version_info.version}`;
  const qualificationItems = project.extracted_data.qualifications;

  return <AppShell title="ภาพรวม TOR" hideTitle><div className="tor-overview-layout"><aside className="tor-overview-side"><p>ภาพรวม TOR</p><div className="tor-overview-utility"><Link className="tor-home-button" href="/dashboard">← กลับสู่หน้าแรก</Link>{project.pdf_url && <a className="tor-header-pdf" href={project.pdf_url} target="_blank" rel="noreferrer">เปิด PDF ต้นฉบับ ↗</a>}</div></aside><div className="tor-overview">
    <header className="tor-overview-header"><div><p className="tor-overview-id">รหัสโครงการ {project.project_id}</p><h1>{project.project_name}</h1><p className="tor-overview-agency">{project.dept_name}{project.dept_sub_name ? ` · ${project.dept_sub_name}` : ""}</p><div className="tor-overview-actions"><span className={project.is_software ? "tor-classification is-software" : "tor-classification"}>{project.is_software ? "โครงการซอฟต์แวร์ / ไอที" : "นอกขอบเขตซอฟต์แวร์"}</span><span className={hasExtractedDocument ? "tor-ai-badge" : "tor-ai-badge is-pending"}>{hasExtractedDocument ? "มีข้อมูลสกัดจากเอกสาร" : "รอข้อมูลจากเอกสาร"}</span></div></div></header>
    <section className="tor-lifecycle" aria-label="สถานะเอกสารและวงจรโครงการ"><div><span>ประเภทโครงการ</span><strong>{project.is_software ? "ซอฟต์แวร์ / ไอที" : "นอกขอบเขตซอฟต์แวร์"}</strong></div><div><span>การดึงข้อมูล PDF</span><strong>{hasExtractedDocument ? "ประมวลผลแล้ว" : hasDocument ? "รอประมวลผล" : "ยังไม่มีเอกสาร"}</strong></div><div><span>เวอร์ชัน / วงจรโครงการ</span><strong>{versionStatus}</strong>{project.version_info.superseded_by && <Link href={`/tors/${project.version_info.superseded_by}`}>ไปยังฉบับใหม่ →</Link>}</div></section>
    <section className="tor-metrics" aria-label="ข้อมูลสำคัญโครงการ"><article><span>งบประมาณ</span><strong>{project.budget.toLocaleString("th-TH")} บาท</strong></article><article><span>วันประกาศ</span><strong>{thaiDate(project.timeline.announce_date)}</strong></article><article><span>สถานะโครงการ</span><strong>{statusLabels[project.project_status] ?? valueOrUnknown(project.project_status)}</strong></article></section>
    <section className="tor-project-summary"><article className="tor-summary-card"><p className="tor-section-kicker">สรุปจากเอกสาร</p><h2>ภาพรวมโครงการ</h2><p>{project.extracted_data.summary || "ยังไม่มีข้อมูลสรุปจากเอกสาร"}</p></article></section>
    <TechStackComparisonCard items={project.extracted_data.tech_stack} />
    <section className="tor-detail-grid"><article className="tor-detail-card"><p className="tor-section-kicker">ข้อมูลโครงการ</p><h2>รายละเอียดที่จัดเก็บ</h2><dl><div><dt>หน่วยงาน</dt><dd>{project.dept_name}</dd></div><div><dt>หน่วยงานย่อย / ฝ่าย</dt><dd>{valueOrUnknown(project.dept_sub_name)}</dd></div><div><dt>วันเริ่มสัญญา</dt><dd>{thaiDate(project.timeline.contract_start)}</dd></div><div><dt>วันสิ้นสุดสัญญา</dt><dd>{thaiDate(project.timeline.contract_end)}</dd></div><div><dt>ระยะเวลาดำเนินการ</dt><dd>{project.timeline.duration_days ? `${project.timeline.duration_days.toLocaleString("th-TH")} วัน` : "ยังไม่มีข้อมูล"}</dd></div><div><dt>บันทึกข้อมูลเมื่อ</dt><dd>{thaiDate(project.created_at)}</dd></div><div><dt>ปรับปรุงข้อมูลเมื่อ</dt><dd>{thaiDate(project.updated_at)}</dd></div><div><dt>เอกสาร PDF ต้นฉบับ</dt><dd>{project.pdf_url ? <a href={project.pdf_url} target="_blank" rel="noreferrer">เปิดเอกสาร ↗</a> : "ยังไม่มีข้อมูล"}</dd></div></dl></article><BidderQualificationCard items={qualificationItems} hasDocument={hasDocument} /></section>
    <DocumentObservationsCard anomalies={project.anomalies} />
    <section className="tor-extracted-data"><AdditionalInfoCard scopeItems={project.extracted_data.scope_of_work} /></section>
  </div></div></AppShell>;
}
