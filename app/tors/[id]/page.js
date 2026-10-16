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
  return Number.isNaN(date.getTime()) ? "ยังไม่มีข้อมูล" : new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Bangkok" }).format(date);
}

function fiscalYearForBidClose(value) {
  if (!value) return "ยังไม่ระบุปีงบประมาณ";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "ยังไม่ระบุปีงบประมาณ";
  const parts = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "numeric", timeZone: "Asia/Bangkok" }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  if (!year || !month) return "ยังไม่ระบุปีงบประมาณ";
  return `ปีงบประมาณ ${year + 543 + (month >= 10 ? 1 : 0)}`;
}

function biddingStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "cancelled") return { label: "ยกเลิก", tone: "cancelled" };
  if (normalized === "closed") return { label: "ปิดรับ", tone: "closed" };
  if (normalized === "open") return { label: "เปิดรับ", tone: "open" };
  return { label: "ไม่ทราบ", tone: "unknown" };
}

function biddingTimeRemaining(closesAt) {
  if (!closesAt) return { label: "ยังไม่ระบุวันปิดรับ", tone: "unknown" };
  const millisecondsLeft = new Date(closesAt).getTime() - Date.now();
  if (Number.isNaN(millisecondsLeft)) return { label: "ยังไม่ระบุวันสิ้นสุด", tone: "unknown" };
  if (millisecondsLeft <= 0) return { label: "หมดเวลาแล้ว", tone: "expired" };
  const totalMinutes = Math.ceil(millisecondsLeft / (1000 * 60));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days) return { label: `เหลือ ${days} วัน ${hours} ชั่วโมง`, tone: days <= 7 ? "urgent" : "open" };
  if (hours) return { label: `เหลือ ${hours} ชั่วโมง ${minutes} นาที`, tone: "urgent" };
  return { label: `เหลือ ${minutes} นาที`, tone: "urgent" };
}

function torStage(phase) {
  const normalized = String(phase || "").trim().toLowerCase().replace(/-/g, "_");
  if (["draft_open", "draftopen"].includes(normalized)) return { label: "ร่าง TOR", tone: "draft" };
  if (["bidding_open", "biddingopen"].includes(normalized)) return { label: "ประกาศเชิญชวน", tone: "official" };
  return { label: "ยังไม่ระบุ", tone: "unknown" };
}

function formatBudget(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value.toLocaleString("th-TH")} บาท`
    : "ยังไม่มีข้อมูล";
}

function thaiTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat("th-TH", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok",
  }).format(date);
}

function submissionDate(bidding) {
  return bidding.submissionDate
    ? thaiDate(`${bidding.submissionDate}T00:00:00+07:00`)
    : thaiDate(bidding.opensAt ?? bidding.closesAt);
}

function submissionStartTime(bidding) {
  return bidding.submissionStartTime ?? thaiTime(bidding.opensAt) ?? "ยังไม่มีข้อมูล";
}

function submissionEndTime(bidding) {
  return bidding.submissionEndTime ?? thaiTime(bidding.closesAt) ?? "ยังไม่มีข้อมูล";
}

function thaiClock(value) {
  return value && value !== "ยังไม่มีข้อมูล" ? value.replace(":", ".") : value;
}

function submissionTimeRange(start, end) {
  if (start === "ยังไม่มีข้อมูล" && end === "ยังไม่มีข้อมูล") return "ยังไม่มีข้อมูล";
  return `${thaiClock(start) ?? "ไม่ระบุ"} – ${thaiClock(end) ?? "ไม่ระบุ"} น.`;
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
    bidding: tor.bidding ?? { status: "unknown", phase: null, closesAt: null },
    documents: tor.documents ?? { tor: null, announcement: null },
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
  const hasDocument = Boolean(project.documents.tor || (project.document?.status && project.document.status !== "unavailable"));
  const versionInfo = project.version_info ?? { version: 1, is_latest: true, superseded_by: null };
  const versionStatus = versionInfo.is_latest ? `ฉบับล่าสุด · เวอร์ชัน ${versionInfo.version}` : `มีฉบับใหม่ · เวอร์ชัน ${versionInfo.version}`;
  const qualificationItems = project.extracted_data.qualifications;
  const status = biddingStatus(project.bidding.status);
  const remainingTime = biddingTimeRemaining(project.bidding.closesAt);
  const stage = torStage(project.bidding.phase);
  const torDocument = project.documents.tor;
  const announcementDocument = project.documents.announcement;
  const torPdfUrl = torDocument?.sourceUrl ?? project.pdf_url;
  const bidDate = submissionDate(project.bidding);
  const bidStartTime = submissionStartTime(project.bidding);
  const bidEndTime = submissionEndTime(project.bidding);

  return <AppShell title="ภาพรวม TOR" hideTitle><div className="tor-overview-layout"><aside className="tor-overview-side"><p>ภาพรวม TOR</p><div className="tor-overview-utility"><Link className="tor-home-button" href="/dashboard">← กลับสู่หน้าแรก</Link>{torPdfUrl && <a className="tor-header-pdf" href={torPdfUrl} target="_blank" rel="noreferrer">เปิด TOR PDF ↗</a>}</div></aside><div className="tor-overview">
    <header className="tor-overview-header"><div><p className="tor-overview-id">รหัสโครงการ {project.project_id}</p><h1>{project.project_name}</h1><p className="tor-overview-agency">{project.dept_name}{project.dept_sub_name ? ` · ${project.dept_sub_name}` : ""}</p><div className="tor-overview-actions tor-priority-actions"><span className={`tor-document-version ${versionInfo.is_latest ? "is-latest" : "is-superseded"}`}>{versionStatus}</span>{torPdfUrl && <a className="tor-detail-pdf-button" href={torPdfUrl} target="_blank" rel="noreferrer">เปิด TOR PDF ↗</a>}{announcementDocument?.sourceUrl && <a className="tor-detail-pdf-button" href={announcementDocument.sourceUrl} target="_blank" rel="noreferrer">ประกาศเชิญชวน ↗</a>}</div></div></header>
    <section className="tor-metrics tor-priority-metrics" aria-label="ข้อมูลสำคัญสำหรับการยื่นข้อเสนอ"><article className="tor-budget-metric"><span>งบประมาณ / ราคากลาง</span><strong>{formatBudget(project.budget)}</strong></article><article><span>ปีงบประมาณ</span><strong>{fiscalYearForBidClose(project.bidding.closesAt)}</strong></article><article><span>วันปิดรับข้อเสนอ</span><strong>{bidDate}</strong></article><article><span>ช่วงเวลารับข้อเสนอ</span><strong>{submissionTimeRange(bidStartTime, bidEndTime)}</strong></article></section>
    <section className="tor-lifecycle tor-priority-lifecycle" aria-label="สถานะการยื่นข้อเสนอและ TOR"><div className={`is-${remainingTime.tone}`}><span>ระยะเวลาคงเหลือ</span><strong>{remainingTime.label}</strong></div><div className={`is-${status.tone}`}><span>สถานะการยื่นข้อเสนอ</span><strong>{status.label}</strong></div><div className={`stage-${stage.tone}`}><span>สถานะ TOR</span><strong>{stage.label}</strong></div></section>
    <ProjectSummaryCard summary={project.extracted_data.summary} />
    <section className="tor-detail-grid"><article className="tor-detail-card"><p className="tor-section-kicker">ข้อมูลโครงการ</p><h2>รายละเอียดที่จัดเก็บ</h2><dl><div><dt>หน่วยงาน</dt><dd>{valueOrUnknown(project.dept_name)}</dd></div><div><dt>หน่วยงานย่อย / ฝ่าย</dt><dd>{valueOrUnknown(project.dept_sub_name)}</dd></div><div><dt>สถานะการยื่นข้อเสนอ</dt><dd>{status.label}</dd></div><div><dt>สถานะ TOR</dt><dd>{stage.label}</dd></div><div><dt>วันยื่นข้อเสนอ</dt><dd>{bidDate}</dd></div><div><dt>เวลาเปิดรับข้อเสนอ</dt><dd>{bidStartTime !== "ยังไม่มีข้อมูล" ? `${bidStartTime} น.` : bidStartTime}</dd></div><div><dt>เวลาปิดรับข้อเสนอ</dt><dd>{bidEndTime !== "ยังไม่มีข้อมูล" ? `${bidEndTime} น.` : bidEndTime}</dd></div><div><dt>TOR PDF</dt><dd>{torPdfUrl ? <a className="tor-document-link" title={torDocument?.filename ?? "เปิดเอกสาร TOR"} href={torPdfUrl} target="_blank" rel="noreferrer">{torDocument?.filename ?? "เปิดเอกสาร TOR"} ↗</a> : "ยังไม่มีเอกสาร TOR"}</dd></div><div><dt>ประกาศเชิญชวน PDF</dt><dd>{announcementDocument?.sourceUrl ? <a className="tor-document-link" title={announcementDocument.filename ?? "เปิดประกาศเชิญชวน"} href={announcementDocument.sourceUrl} target="_blank" rel="noreferrer">{announcementDocument.filename ?? "เปิดประกาศเชิญชวน"} ↗</a> : "ยังไม่มีประกาศเชิญชวน"}</dd></div><div><dt>บันทึกข้อมูลเมื่อ</dt><dd>{thaiDate(project.created_at)}</dd></div><div><dt>ปรับปรุงข้อมูลเมื่อ</dt><dd>{thaiDate(project.updated_at)}</dd></div></dl></article><BidderQualificationCard items={qualificationItems} hasDocument={hasDocument} /></section>
    <DocumentObservationsCard anomalies={project.anomalies} />
    <section className="tor-extracted-data"><AdditionalInfoCard scopeItems={project.extracted_data.scope_of_work} /></section>
    <TechStackComparisonCard items={project.extracted_data.tech_stack} />
  </div></div></AppShell>;
}
