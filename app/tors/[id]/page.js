import Link from "next/link";
import { headers } from "next/headers";
import AppShell from "@/components/ui/AppShell";
import AdditionalInfoCard from "@/components/ui/AdditionalInfoCard";
import BidderQualificationCard from "@/components/ui/BidderQualificationCard";
import DocumentObservationsCard from "@/components/ui/DocumentObservationsCard";
import ProjectSummaryCard from "@/components/ui/ProjectSummaryCard";
import TechStackComparisonCard from "@/components/ui/TechStackComparisonCard";
import { getTorDetail } from "@/lib/services/tor-service";

function valueOrUnknown(value) {
  return value || "ยังไม่มีข้อมูล";
}

function thaiDate(value) {
  if (!value) return "ยังไม่มีข้อมูล";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "ยังไม่มีข้อมูล" : new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

function fiscalYears(contractStart, contractEnd) {
  if (!contractStart) return "ยังไม่ระบุปีงบประมาณ";
  const start = new Date(contractStart);
  if (Number.isNaN(start.getTime())) return "ยังไม่ระบุปีงบประมาณ";

  const fiscalYearFor = (date) => date.getUTCFullYear() + 543 + (date.getUTCMonth() >= 9 ? 1 : 0);
  const firstYear = fiscalYearFor(start);
  const end = contractEnd ? new Date(contractEnd) : null;
  const lastYear = end && !Number.isNaN(end.getTime()) && end >= start ? fiscalYearFor(end) : firstYear;
  return firstYear === lastYear ? `ปีงบประมาณ ${firstYear}` : `ปีงบประมาณ ${firstYear}–${lastYear}`;
}

function biddingStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (["cancelled", "ยกเลิก"].includes(normalized)) return { label: "ยกเลิก", tone: "cancelled" };
  if (["superseded", "invalid", "มีฉบับใหม่", "ไม่ถูกต้อง", "ปิดรับ", "ปิดรับแล้ว"].includes(normalized)) return { label: "ปิดรับ", tone: "closed" };
  return { label: "เปิดรับ", tone: "open" };
}

function biddingTimeRemaining(contractEnd) {
  if (!contractEnd) return { label: "ยังไม่ระบุวันสิ้นสุด", tone: "unknown" };
  const millisecondsLeft = new Date(contractEnd).getTime() - Date.now();
  if (Number.isNaN(millisecondsLeft)) return { label: "ยังไม่ระบุวันสิ้นสุด", tone: "unknown" };
  if (millisecondsLeft <= 0) return { label: "หมดเวลาแล้ว", tone: "expired" };
  const hoursLeft = Math.ceil(millisecondsLeft / (1000 * 60 * 60));
  if (hoursLeft < 24) return { label: `เหลือ ${hoursLeft} ชั่วโมง`, tone: "urgent" };
  const daysLeft = Math.ceil(hoursLeft / 24);
  return { label: `เหลือ ${daysLeft} วัน`, tone: daysLeft <= 7 ? "urgent" : "open" };
}

function projectStage(contractStart) {
  if (!contractStart) return { label: "ร่าง TOR", tone: "draft" };
  const millisecondsUntilStart = new Date(contractStart).getTime() - Date.now();
  if (Number.isNaN(millisecondsUntilStart)) return { label: "ร่าง TOR", tone: "draft" };
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  if (millisecondsUntilStart > thirtyDays) return { label: "TOR ฉบับจริง", tone: "official" };
  if (millisecondsUntilStart >= -thirtyDays) return { label: "อยู่ระหว่างพิจารณาผล / ประกาศผู้ชนะ", tone: "review" };
  return { label: "ยกเลิกโครงการ / ลงนามสัญญาแล้ว", tone: "closed" };
}

function detailToProjectRecord(tor) {
  const highBudgetAnomaly = tor.anomalies.find((anomaly) => anomaly.type === "high_budget");
  const flaggedClauses = tor.anomalies
    .filter((anomaly) => anomaly.type === "flagged_clause")
    .map((anomaly) => ({
      clause_text: anomaly.clauseText,
      reason: anomaly.reason,
      explanation: anomaly.explanation,
      highlight_reason: anomaly.highlightReason,
      category: anomaly.category,
      severity: anomaly.severity,
      page: anomaly.page,
      confidence: anomaly.confidence,
    }));

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
      version: tor.version?.number ?? 1,
      is_latest: tor.version?.isLatest ?? true,
      superseded_by: tor.version?.supersededBy ?? null,
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
  const versionInfo = project.version_info ?? { version: 1, is_latest: true, superseded_by: null };
  const versionStatus = versionInfo.is_latest ? `ฉบับล่าสุด · เวอร์ชัน ${versionInfo.version}` : `มีฉบับใหม่ · เวอร์ชัน ${versionInfo.version}`;
  const qualificationItems = project.extracted_data.qualifications;
  const status = biddingStatus(project.project_status);
  const remainingTime = biddingTimeRemaining(project.timeline.contract_end);
  const stage = projectStage(project.timeline.contract_start);

  return <AppShell title="ภาพรวม TOR" hideTitle><div className="tor-overview-layout"><aside className="tor-overview-side"><p>ภาพรวม TOR</p><div className="tor-overview-utility"><Link className="tor-home-button" href="/dashboard">← กลับสู่หน้าแรก</Link>{project.pdf_url && <a className="tor-header-pdf" href={project.pdf_url} target="_blank" rel="noreferrer">เปิด PDF ต้นฉบับ ↗</a>}</div></aside><div className="tor-overview">
    <header className="tor-overview-header"><div><p className="tor-overview-id">รหัสโครงการ {project.project_id}</p><h1>{project.project_name}</h1><p className="tor-overview-agency">{project.dept_name}{project.dept_sub_name ? ` · ${project.dept_sub_name}` : ""}</p><div className="tor-overview-actions tor-priority-actions"><span className={`tor-document-version ${versionInfo.is_latest ? "is-latest" : "is-superseded"}`}>{versionStatus}</span>{project.pdf_url && <a className="tor-detail-pdf-button" href={project.pdf_url} target="_blank" rel="noreferrer">เปิด PDF ต้นฉบับ ↗</a>}</div></div></header>
    <section className="tor-metrics tor-priority-metrics" aria-label="ข้อมูลสำคัญสำหรับการยื่นข้อเสนอ"><article className="tor-budget-metric"><span>งบประมาณ</span><strong>{project.budget.toLocaleString("th-TH")} บาท</strong></article><article><span>ปีงบประมาณ</span><strong>{fiscalYears(project.timeline.contract_start, project.timeline.contract_end)}</strong></article><article><span>ปิดรับข้อเสนอ</span><strong>{thaiDate(project.timeline.contract_end)}</strong></article></section>
    <section className="tor-lifecycle tor-priority-lifecycle" aria-label="สถานะการยื่นข้อเสนอและ TOR"><div className={`is-${remainingTime.tone}`}><span>ระยะเวลายื่นข้อเสนอ</span><strong title="คำนวณชั่วคราวจากวันสิ้นสุดสัญญา">{remainingTime.label}</strong></div><div className={`is-${status.tone}`}><span>สถานะการยื่นข้อเสนอ</span><strong>{status.label}</strong></div><div className={`stage-${stage.tone}`}><span>สถานะ TOR</span><strong>{stage.label}</strong></div></section>
    <ProjectSummaryCard summary={project.extracted_data.summary} />
    <section className="tor-detail-grid"><article className="tor-detail-card"><p className="tor-section-kicker">ข้อมูลโครงการ</p><h2>รายละเอียดที่จัดเก็บ</h2><dl><div><dt>หน่วยงาน</dt><dd>{project.dept_name}</dd></div><div><dt>หน่วยงานย่อย / ฝ่าย</dt><dd>{valueOrUnknown(project.dept_sub_name)}</dd></div><div><dt>สถานะการยื่นข้อเสนอ</dt><dd title="ใช้ project_status ชั่วคราว">{status.label}</dd></div><div><dt>วันเปิดรับข้อเสนอ</dt><dd>{thaiDate(project.timeline.contract_start)} <small>(ใช้วันเริ่มสัญญาชั่วคราว)</small></dd></div><div><dt>วันปิดรับข้อเสนอ</dt><dd>{thaiDate(project.timeline.contract_end)} <small>(ใช้วันสิ้นสุดสัญญาชั่วคราว)</small></dd></div><div><dt>วันเริ่มสัญญา</dt><dd>{thaiDate(project.timeline.contract_start)}</dd></div><div><dt>วันสิ้นสุดสัญญา</dt><dd>{thaiDate(project.timeline.contract_end)}</dd></div><div><dt>ระยะเวลาดำเนินการ</dt><dd>{project.timeline.duration_days ? `${project.timeline.duration_days.toLocaleString("th-TH")} วัน` : "ยังไม่มีข้อมูล"}</dd></div><div><dt>บันทึกข้อมูลเมื่อ</dt><dd>{thaiDate(project.created_at)}</dd></div><div><dt>ปรับปรุงข้อมูลเมื่อ</dt><dd>{thaiDate(project.updated_at)}</dd></div><div><dt>เอกสาร PDF ต้นฉบับ</dt><dd>{project.pdf_url ? <a href={project.pdf_url} target="_blank" rel="noreferrer">เปิดเอกสาร ↗</a> : "ยังไม่มีข้อมูล"}</dd></div></dl></article><BidderQualificationCard items={qualificationItems} hasDocument={hasDocument} /></section>
    <DocumentObservationsCard anomalies={project.anomalies} />
    <section className="tor-extracted-data"><AdditionalInfoCard scopeItems={project.extracted_data.scope_of_work} /></section>
    <TechStackComparisonCard items={project.extracted_data.tech_stack} />
  </div></div></AppShell>;
}
