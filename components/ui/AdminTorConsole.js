"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

function hasExtractedData(project) {
  return Boolean((project.extracted_data.summary && project.extracted_data.summary !== "ยังไม่มีข้อมูล") || project.extracted_data.qualifications.length || project.extracted_data.scope_of_work.length || project.extracted_data.tech_stack.length);
}

function formatDate(date) {
  if (!date) return "ยังไม่มีข้อมูล";
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? "ยังไม่มีข้อมูล" : new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric" }).format(parsed);
}

// Preview-only data. Its shape deliberately follows GET /api/admin/classification/queue
// so the visual layer can be wired to the review API without a redesign later.
const previewQueue = [
  { projectId: "66109010123", projectTitle: "โครงการพัฒนาระบบบริหารจัดการข้อมูลสุขภาพ", issuingAgency: "สำนักการแพทย์ กรุงเทพมหานคร", confidenceScore: 0.55, confidenceScores: { classification: 0.55, extraction: 0.78 }, reviewReasons: ["low_classification_confidence"], processingStatus: "review_required", updatedAt: "27 ต.ค. 2569 · 09:42 น." },
  { projectId: "66109010118", projectTitle: "จัดซื้อระบบกล้องวงจรปิดพร้อมอุปกรณ์", issuingAgency: "สำนักงานเขตบางกะปิ", confidenceScore: 0.62, confidenceScores: { classification: 0.83, extraction: 0.62 }, reviewReasons: ["low_extraction_confidence"], processingStatus: "review_required", updatedAt: "27 ต.ค. 2569 · 08:55 น." },
  { projectId: "66109010097", projectTitle: "จ้างพัฒนาระบบติดตามโครงการก่อสร้าง", issuingAgency: "สำนักการโยธา กรุงเทพมหานคร", confidenceScore: 0.48, confidenceScores: { classification: 0.48, extraction: 0.71 }, reviewReasons: ["low_classification_confidence"], processingStatus: "retry_pending", updatedAt: "26 ต.ค. 2569 · 16:18 น." },
  { projectId: "66109010084", projectTitle: "โครงการจัดหาอุปกรณ์เครือข่ายสำหรับโรงเรียน", issuingAgency: "สำนักการศึกษา กรุงเทพมหานคร", confidenceScore: 0.68, confidenceScores: { classification: 0.68, extraction: 0.89 }, reviewReasons: ["low_classification_confidence"], processingStatus: "document_pending", updatedAt: "26 ต.ค. 2569 · 14:31 น." },
  { projectId: "66109010061", projectTitle: "จ้างเหมาปรับปรุงระบบสารสนเทศงานบริการประชาชน", issuingAgency: "สำนักงานเลขานุการปลัดกรุงเทพมหานคร", confidenceScore: 0.59, confidenceScores: { classification: 0.59, extraction: 0.65 }, reviewReasons: ["low_classification_confidence", "low_extraction_confidence"], processingStatus: "review_required", updatedAt: "25 ต.ค. 2569 · 11:05 น." },
];

const reasonLabel = { low_classification_confidence: "การจำแนกไม่ชัดเจน", low_extraction_confidence: "ข้อมูลเอกสารไม่ครบ" };
const percent = (value) => `${Math.round(value * 100)}%`;
const confidenceTone = (value) => value < 0.55 ? "critical" : value < 0.65 ? "warning" : "caution";
const processingLabel = (status) => ({ review_required: "รอตรวจสอบ", retry_pending: "รอลองใหม่", document_pending: "รอเอกสาร" })[status] || "รอตรวจสอบ";

export default function AdminTorConsole() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [isPulling, setIsPulling] = useState(false);
  const [pullMessage, setPullMessage] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [resolvedIds, setResolvedIds] = useState([]);

  const visibleItems = useMemo(() => previewQueue.filter((item) => {
    const matchesQuery = `${item.projectId} ${item.projectTitle} ${item.issuingAgency}`.toLowerCase().includes(query.toLowerCase());
    const matchesFilter = filter === "all" || (filter === "classification" && item.reviewReasons.includes("low_classification_confidence")) || (filter === "extraction" && item.reviewReasons.includes("low_extraction_confidence"));
    return matchesQuery && matchesFilter && !resolvedIds.includes(item.projectId);
  }), [filter, query, resolvedIds]);

  function startPull() {
    if (isPulling) return;
    setIsPulling(true);
    setPullMessage("กำลังเชื่อมต่อ e-GP และตรวจสอบรายการใหม่…");
    window.setTimeout(() => setPullMessage("กำลังจัดเตรียมรายการเข้าสู่คิวประมวลผล…"), 850);
    window.setTimeout(() => { setIsPulling(false); setPullMessage("โหมดตัวอย่าง: เมื่อเชื่อมต่อแล้ว ระบบจะแสดงผลการนำเข้าและรีเฟรชสถานะให้อัตโนมัติ"); }, 1800);
  }

  function resolveItem(projectId, action) {
    setBusyAction(`${projectId}:${action}`);
    window.setTimeout(() => { setResolvedIds((current) => [...current, projectId]); setBusyAction(""); }, 500);
  }

  return <div className="admin-ops">
    <section className="admin-ops-hero">
      <div className="admin-ops-hero-copy"><p className="admin-ops-eyebrow"><span aria-hidden="true">◌</span> ศูนย์ปฏิบัติการข้อมูล</p><h1>ตรวจสอบ TOR ที่ระบบยังไม่มั่นใจ</h1><span>ยืนยันผลการจำแนก ดูสุขภาพการนำเข้าข้อมูล และจัดการรายการที่ต้องอาศัยการตัดสินใจของผู้ดูแล</span></div>
      <div className="admin-ops-hero-actions"><Link className="admin-ops-rules-link" href="/admin/keywords">จัดการกฎคีย์เวิร์ด <span aria-hidden="true">→</span></Link><button className="admin-pull-button" type="button" onClick={startPull} disabled={isPulling}>{isPulling ? <><i className="admin-spinner" aria-hidden="true" /> กำลังนำเข้าข้อมูล</> : <><span aria-hidden="true">↓</span> เริ่มนำเข้าข้อมูล</>}</button></div>
    </section>
    <p className={`admin-ops-live-message ${pullMessage ? "is-visible" : ""}`} role="status" aria-live="polite">{pullMessage || "พร้อมตรวจสอบข้อมูลล่าสุด"}</p>
    <section className="admin-ops-metrics" aria-label="สถานะการนำเข้าข้อมูล">
      <article className="admin-ops-metric"><div className="admin-ops-metric-icon is-calendar" aria-hidden="true">◷</div><div><span>นำเข้าข้อมูลอัตโนมัติล่าสุด</span><strong>27 ต.ค. 2569 · 08:30 น.</strong><small>ทำงานตามกำหนดเวลา</small></div></article>
      <article className="admin-ops-metric"><div className="admin-ops-metric-icon is-projects" aria-hidden="true">▦</div><div><span>โครงการที่นำเข้าแล้ว</span><strong>1,248 <em>รายการ</em></strong><small>เพิ่มขึ้น 24 รายการในรอบล่าสุด</small></div></article>
      <article className="admin-ops-metric is-healthy"><div className="admin-ops-metric-icon is-health" aria-hidden="true">✓</div><div><span>สุขภาพการดึงข้อมูล</span><strong>ปกติ</strong><small><i aria-hidden="true" /> ระบบเชื่อมต่อและคิวทำงานปกติ</small></div></article>
    </section>
    <section className="admin-review-panel">
      <header className="admin-review-heading"><div><p>REVIEW QUEUE</p><h2>รายการที่ต้องตรวจสอบ</h2><span>ความมั่นใจต่ำกว่า 70% จะถูกส่งมาที่นี่เพื่อให้ผู้ดูแลยืนยันผลก่อนใช้งานต่อ</span></div><div className="admin-review-count"><strong>{previewQueue.length - resolvedIds.length}</strong><span>รายการรอตรวจสอบ</span></div></header>
      <div className="admin-review-controls"><label className="admin-review-search"><span aria-hidden="true">⌕</span><span className="sr-only">ค้นหารายการ TOR</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหารหัสโครงการ ชื่อ หรือหน่วยงาน" /></label><label className="admin-review-filter"><span className="sr-only">กรองสาเหตุ</span><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">ทุกสาเหตุ</option><option value="classification">การจำแนกไม่ชัดเจน</option><option value="extraction">ข้อมูลเอกสารไม่ครบ</option></select></label></div>
      <div className="admin-review-table-wrap"><table className="admin-review-table"><thead><tr><th scope="col">โครงการ</th><th scope="col">ความมั่นใจ</th><th scope="col">สาเหตุที่ต้องตรวจสอบ</th><th scope="col">สถานะ</th><th scope="col"><span className="sr-only">การดำเนินการ</span></th></tr></thead><tbody>{visibleItems.map((item) => <tr key={item.projectId}><td data-label="โครงการ"><div className="admin-project-cell"><span>{item.projectId}</span><strong>{item.projectTitle}</strong><small>{item.issuingAgency} · อัปเดต {item.updatedAt}</small></div></td><td data-label="ความมั่นใจ"><div className="admin-confidence-cell"><b className={`admin-confidence-badge is-${confidenceTone(item.confidenceScore)}`}>{percent(item.confidenceScore)} <span>Confidence</span></b><small>จำแนก {percent(item.confidenceScores.classification)} · เอกสาร {percent(item.confidenceScores.extraction)}</small></div></td><td data-label="สาเหตุที่ต้องตรวจสอบ"><div className="admin-reason-list">{item.reviewReasons.map((reason) => <span key={reason}>{reasonLabel[reason]}</span>)}</div></td><td data-label="สถานะ"><span className={`admin-processing-status is-${item.processingStatus}`}>{processingLabel(item.processingStatus)}</span></td><td data-label="การดำเนินการ"><div className="admin-row-actions"><button type="button" disabled={Boolean(busyAction)} onClick={() => resolveItem(item.projectId, "software")}>{busyAction === `${item.projectId}:software` ? "กำลังบันทึก…" : "ยืนยันเป็น Software"}</button><button type="button" className="is-secondary" disabled={Boolean(busyAction)} onClick={() => resolveItem(item.projectId, "non-software")}>ไม่ใช่ Software</button><button type="button" className="is-danger" disabled={Boolean(busyAction)} onClick={() => resolveItem(item.projectId, "invalidate")}>ไม่ใช้รายการนี้</button></div></td></tr>)}{visibleItems.length === 0 && <tr><td className="admin-review-empty" colSpan="5"><strong>ไม่มีรายการที่ตรงกับตัวกรอง</strong><span>รายการที่ยืนยันแล้วจะไม่แสดงในคิวนี้</span></td></tr>}</tbody></table></div>
      <footer className="admin-review-footer"><span><i aria-hidden="true">●</i> โหมดตัวอย่างหน้าจอ — ยังไม่ได้เชื่อมต่อกับข้อมูลจริง</span><button type="button" onClick={() => setResolvedIds([])} disabled={resolvedIds.length === 0}>แสดงรายการตัวอย่างอีกครั้ง</button></footer>
    </section>
  </div>;
}

function LegacyAdminTorConsole({ projects }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [message, setMessage] = useState("");
  const visibleProjects = useMemo(() => projects.filter((project) => {
    const text = `${project.project_id} ${project.project_name} ${project.dept_name}`.toLowerCase();
    const matchesFilter = filter === "all" || (filter === "document" && hasExtractedData(project)) || (filter === "pending" && !hasExtractedData(project)) || (filter === "anomaly" && (project.anomalies.high_budget_flag || project.anomalies.flagged_clauses.length));
    return text.includes(query.toLowerCase()) && matchesFilter;
  }), [filter, projects, query]);
  const readyCount = projects.filter(hasExtractedData).length;
  const anomalyCount = projects.filter((project) => project.anomalies.high_budget_flag || project.anomalies.flagged_clauses.length).length;

  async function togglePublished(id) {
    // This action queues real processing; it does not pretend to publish a record.
    try {
      const response = await fetch('/api/processing/trigger', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: id }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || 'ไม่สามารถเข้าคิวได้');
      setMessage(`เข้าคิวประมวลผล ${id} แล้ว — ต้องเปิด worker`);
    } catch (error) { setMessage(error.message); }
  }

  async function ingest() {
    setMessage('กำลังขอข้อมูล…');
    try {
      const response = await fetch('/api/ingestion/trigger', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit: 5, enqueueProcessing: true }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || 'นำเข้าไม่สำเร็จ');
      setMessage(`พบ ${result.itemsFound} รายการ · เก็บผู้สมัคร ${result.candidatesSaved || 0} · เข้าคิว ${result.jobsQueued} — เปิด worker เพื่อตรวจสอบและประมวลผล`);
    } catch (error) { setMessage(error.message); }
  }

  return <div className="admin-console"><section className="admin-hero"><div><p>พื้นที่ผู้ดูแลระบบ · MongoDB</p><h1>จัดการรายการ TOR</h1><span>ตรวจสอบข้อมูลที่นำเข้า ความพร้อมของข้อมูลเอกสาร และเวอร์ชัน</span></div><button type="button" onClick={ingest}>เริ่มนำเข้าข้อมูล</button></section>
    <section className="admin-metrics" aria-label="สรุปสถานะรายการ TOR"><article><span>รายการที่จัดเก็บ</span><strong>{projects.length.toLocaleString("th-TH")}</strong></article><article><span>ข้อมูลเอกสารพร้อมใช้</span><strong>{readyCount.toLocaleString("th-TH")}</strong></article><article><span>รอข้อมูลเอกสาร</span><strong>{(projects.length - readyCount).toLocaleString("th-TH")}</strong></article><article><span>รายการที่มีข้อสังเกต</span><strong>{anomalyCount.toLocaleString("th-TH")}</strong></article></section>
    <section className="admin-list-card">
      <div className="admin-list-heading"><div><p>รายการ TOR</p><h2>จัดการข้อมูลที่จัดเก็บ</h2><span>ประมวลผลผ่านคิวจริง — ต้องเปิด worker เพื่อทำงานต่อ</span></div><p role="status">{message}</p></div>
      <div className="admin-controls"><label><span className="sr-only">ค้นหา TOR</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหารหัสโครงการ ชื่อ หรือหน่วยงาน" /></label><label><span className="sr-only">กรองสถานะ</span><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">ทุกรายการ</option><option value="document">ข้อมูลเอกสารพร้อมใช้</option><option value="pending">รอข้อมูลเอกสาร</option><option value="anomaly">มีข้อสังเกต</option></select></label></div>
      <div className="admin-tor-list">{visibleProjects.map((project) => {
        const extracted = hasExtractedData(project);
        const hasAnomaly = project.anomalies.high_budget_flag || project.anomalies.flagged_clauses.length > 0;
        return <article className="admin-tor-row" key={project.project_id}>
          <div className="admin-tor-main"><p><span>{project.project_id}</span>{hasAnomaly && <b>มีข้อสังเกต</b>}</p><h3>{project.project_name}</h3><small>{project.dept_name} · ประกาศ {formatDate(project.timeline.announce_date)}</small></div>
          <div className="admin-tor-meta"><span>งบประมาณ</span><strong>{project.budget != null ? `${project.budget.toLocaleString("th-TH")} บาท` : "ยังไม่ระบุงบประมาณ"}</strong></div>
          <div className="admin-tor-state"><span className={extracted ? "is-ready" : "is-pending"}>{extracted ? "ข้อมูลเอกสารพร้อมใช้" : "รอข้อมูลเอกสาร"}</span><span>{project.version_info.is_latest ? `ฉบับล่าสุด v${project.version_info.version}` : `มีฉบับใหม่ v${project.version_info.version}`}</span><span>{project.processing?.status}</span></div>
          <div className="admin-tor-actions"><Link href={`/tors/${project.project_id}`}>ดูรายละเอียด</Link><button type="button" onClick={() => togglePublished(project.project_id)}>เข้าคิวประมวลผล</button></div>
        </article>;
      })}{visibleProjects.length === 0 && <p className="admin-empty">ไม่พบรายการที่ตรงกับตัวกรอง</p>}</div>
    </section>
  </div>;
}
