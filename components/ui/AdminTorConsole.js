"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

function hasExtractedData(project) {
  return Boolean((project.extracted_data.summary && project.extracted_data.summary !== "ยังไม่มีข้อมูล") || project.extracted_data.qualifications.length || project.extracted_data.scope_of_work.length || project.extracted_data.tech_stack.length);
}

function formatDate(date) {
  if (!date) return "ยังไม่มีข้อมูล";
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? "ยังไม่มีข้อมูล" : new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric" }).format(parsed);
}

const reasonLabel = { low_classification_confidence: "การจำแนกไม่ชัดเจน", low_extraction_confidence: "ข้อมูลเอกสารไม่ครบ" };
const QUEUE_PAGE_SIZE = 5;
const percent = (value) => `${Math.round(value * 100)}%`;
const confidenceTone = (value) => value < 0.55 ? "critical" : value < 0.65 ? "warning" : "caution";
const processingLabel = (status) => ({ review_required: "รอตรวจสอบ", retry_pending: "รอลองใหม่", document_pending: "รอเอกสาร" })[status] || "รอตรวจสอบ";

function formatBangkokDateTime(value) {
  if (!value) return "ยังไม่มีข้อมูล";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "ยังไม่มีข้อมูล";
  return new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }).format(date);
}

function scrapingHealth(run) {
  if (run?.status === "succeeded") return { label: "ปกติ", detail: "ระบบเชื่อมต่อและคิวทำงานปกติ", tone: "healthy" };
  if (run?.status === "failed") return { label: "ต้องตรวจสอบ", detail: "การดึงข้อมูลรอบล่าสุดไม่สำเร็จ", tone: "failed" };
  return { label: "กำลังดำเนินการ", detail: "รอตรวจสอบผลการดึงข้อมูลล่าสุด", tone: "pending" };
}

function mapReviewItem(item) {
  return {
    projectId: item.projectId,
    projectTitle: item.projectTitle || "ยังไม่ระบุชื่อโครงการ",
    issuingAgency: item.issuingAgency || "ยังไม่ระบุหน่วยงาน",
    confidenceScore: Number.isFinite(item.confidenceScore) ? item.confidenceScore : 0,
    confidenceScores: { classification: item.confidenceScores?.classification ?? 0, extraction: item.confidenceScores?.extraction ?? 0 },
    reviewReasons: item.reviewReasons || [],
    processingStatus: item.processingStatus,
  };
}

export default function AdminTorConsole() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [queue, setQueue] = useState([]);
  const [queueTotal, setQueueTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState("");
  const [pullMessage, setPullMessage] = useState("");
  const [messageTone, setMessageTone] = useState("info");
  const [reviewingProject, setReviewingProject] = useState("");
  const [queueRevision, setQueueRevision] = useState(0);
  const [operations, setOperations] = useState({ loading: true, totalProjects: null, lastRun: null, error: "" });
  const queueCache = useRef(new Map());

  useEffect(() => {
    let active = true;
    async function loadOperations() {
      try {
        const response = await fetch("/api/ingestion/status");
        const result = await response.json();
        if (!response.ok) throw new Error(result.error?.message || "ไม่สามารถโหลดสถานะการนำเข้าข้อมูลได้");
        if (active) setOperations({ loading: false, totalProjects: result.totalProjects, lastRun: result.lastRun || null, error: "" });
      } catch (error) {
        if (active) setOperations({ loading: false, totalProjects: null, lastRun: null, error: error.message || "ไม่สามารถโหลดสถานะได้" });
      }
    }
    void loadOperations();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    async function fetchPage(pageNumber) {
      const response = await fetch(`/api/admin/classification/queue?page=${pageNumber}&pageSize=${QUEUE_PAGE_SIZE}&confidenceType=either`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || "ไม่สามารถโหลดคิวตรวจสอบได้");
      const mapped = { items: (result.items || []).map(mapReviewItem), total: Number.isFinite(result.total) ? result.total : 0 };
      queueCache.current.set(pageNumber, mapped);
      return mapped;
    }

    async function loadQueue() {
      setQueueLoading(true);
      setQueueError("");
      try {
        const result = queueCache.current.get(page) || await fetchPage(page);
        if (active) {
          setQueue(result.items);
          setQueueTotal(result.total);
          const nextPage = page + 1;
          const totalPages = Math.ceil(result.total / QUEUE_PAGE_SIZE);
          if (nextPage <= totalPages && !queueCache.current.has(nextPage)) {
            void fetchPage(nextPage).catch(() => {});
          }
        }
      } catch (error) {
        if (active) setQueueError(error.message || "ไม่สามารถโหลดคิวตรวจสอบได้");
      } finally {
        if (active) setQueueLoading(false);
      }
    }
    void loadQueue();
    return () => { active = false; };
  }, [page, queueRevision]);

  const visibleItems = useMemo(() => queue.filter((item) => {
    const matchesQuery = `${item.projectId} ${item.projectTitle} ${item.issuingAgency}`.toLowerCase().includes(query.toLowerCase());
    const matchesFilter = filter === "all" || (filter === "classification" && item.reviewReasons.includes("low_classification_confidence")) || (filter === "extraction" && item.reviewReasons.includes("low_extraction_confidence"));
    return matchesQuery && matchesFilter;
  }), [filter, query, queue]);
  const totalPages = Math.max(1, Math.ceil(queueTotal / QUEUE_PAGE_SIZE));
  const health = scrapingHealth(operations.lastRun);

  function startPull() {
    setMessageTone("info");
    setPullMessage("ปุ่มนำเข้าข้อมูลยังไม่ได้เชื่อมต่อ — หน้านี้กำลังอ่านคิว TOR เท่านั้น");
  }

  async function reviewTor(projectId, isSoftware) {
    setReviewingProject(projectId);
    setMessageTone("info");
    setPullMessage("กำลังบันทึกผลการตรวจสอบ TOR…");
    try {
      const response = await fetch(`/api/admin/tors/${encodeURIComponent(projectId)}/classification`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isSoftware,
          reason: isSoftware ? "Confirmed as software from the admin review queue" : "Confirmed as non-software from the admin review queue",
          enqueueProcessing: isSoftware,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || "ไม่สามารถบันทึกผลการตรวจสอบได้");
      queueCache.current.clear();
      setQueueRevision((current) => current + 1);
      setMessageTone("success");
      setPullMessage(isSoftware ? "ยืนยันเป็น Software แล้ว และส่งเข้าคิวประมวลผลแล้ว" : "ระบุว่าไม่ใช่ Software แล้ว");
    } catch (error) {
      setMessageTone("error");
      setPullMessage(error.message || "ไม่สามารถบันทึกผลการตรวจสอบได้");
    } finally {
      setReviewingProject("");
    }
  }

  return <div className="admin-ops">
    <section className="admin-ops-hero">
      <div className="admin-ops-hero-copy"><p className="admin-ops-eyebrow"><span aria-hidden="true">◌</span> ศูนย์ปฏิบัติการข้อมูล</p><h1>ตรวจสอบ TOR ที่ระบบยังไม่มั่นใจ</h1><span>ยืนยันผลการจำแนก ดูสุขภาพการนำเข้าข้อมูล และจัดการรายการที่ต้องอาศัยการตัดสินใจของผู้ดูแล</span></div>
      <div className="admin-ops-hero-actions"><Link className="admin-ops-rules-link" href="/admin/keywords">จัดการกฎคีย์เวิร์ด <span aria-hidden="true">→</span></Link><button className="admin-pull-button" type="button" onClick={startPull}><span aria-hidden="true">↓</span> เริ่มนำเข้าข้อมูล</button></div>
    </section>
    <p className={`admin-ops-live-message ${pullMessage ? "is-visible" : ""} is-${messageTone}`} role="status" aria-live="polite">{pullMessage || operations.error || "พร้อมตรวจสอบข้อมูลล่าสุด"}</p>
    <section className="admin-ops-metrics" aria-label="สถานะการนำเข้าข้อมูล">
      <article className="admin-ops-metric"><div className="admin-ops-metric-icon is-calendar" aria-hidden="true">◷</div><div><span>นำเข้าข้อมูลอัตโนมัติล่าสุด</span><strong>{operations.loading ? "กำลังโหลด…" : formatBangkokDateTime(operations.lastRun?.finished_at || operations.lastRun?.started_at)}</strong><small>{operations.lastRun?.status === "succeeded" ? "ทำงานตามกำหนดเวลา" : "อ้างอิงจากรอบการนำเข้าล่าสุด"}</small></div></article>
      <article className="admin-ops-metric"><div className="admin-ops-metric-icon is-projects" aria-hidden="true">▦</div><div><span>โครงการที่นำเข้าแล้ว</span><strong>{operations.loading ? "…" : (operations.totalProjects ?? 0).toLocaleString("th-TH")} <em>รายการ</em></strong><small>{operations.lastRun?.stored_count != null ? `จัดเก็บ ${operations.lastRun.stored_count.toLocaleString("th-TH")} รายการในรอบล่าสุด` : "กำลังรอข้อมูลรอบล่าสุด"}</small></div></article>
      <article className={`admin-ops-metric is-${health.tone}`}><div className="admin-ops-metric-icon is-health" aria-hidden="true">{health.tone === "healthy" ? "✓" : "!"}</div><div><span>สุขภาพการดึงข้อมูล</span><strong>{operations.loading ? "กำลังตรวจสอบ…" : health.label}</strong><small><i aria-hidden="true" /> {operations.loading ? "กำลังโหลดสถานะระบบ" : health.detail}</small></div></article>
    </section>
    <section className="admin-review-panel">
      <header className="admin-review-heading"><div><p>REVIEW QUEUE</p><h2>รายการที่ต้องตรวจสอบ</h2><span>ความมั่นใจต่ำกว่า 70% จะถูกส่งมาที่นี่เพื่อให้ผู้ดูแลยืนยันผลก่อนใช้งานต่อ</span></div><div className="admin-review-count"><strong>{queueLoading ? "…" : queueTotal.toLocaleString("th-TH")}</strong><span>{queueLoading ? "กำลังโหลดรายการ" : `แสดง ${queue.length.toLocaleString("th-TH")} จาก ${queueTotal.toLocaleString("th-TH")}`}</span></div></header>
      <div className="admin-review-controls"><label className="admin-review-search"><span aria-hidden="true">⌕</span><span className="sr-only">ค้นหารายการ TOR</span><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="ค้นหารหัสโครงการ ชื่อ หรือหน่วยงาน" /></label><label className="admin-review-filter"><span className="sr-only">กรองสาเหตุ</span><select value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1); }}><option value="all">ทุกสาเหตุ</option><option value="classification">การจำแนกไม่ชัดเจน</option><option value="extraction">ข้อมูลเอกสารไม่ครบ</option></select></label></div>
      <div className="admin-review-table-wrap"><table className="admin-review-table"><thead><tr><th scope="col">โครงการ</th><th scope="col">ความมั่นใจ</th><th scope="col">สาเหตุที่ต้องตรวจสอบ</th><th scope="col">สถานะ</th><th scope="col"><span className="sr-only">การดำเนินการ</span></th></tr></thead><tbody>{queueLoading && <tr><td className="admin-review-empty" colSpan="5"><strong>กำลังโหลดคิวตรวจสอบ…</strong></td></tr>}{!queueLoading && visibleItems.map((item) => <tr key={item.projectId}><td data-label="โครงการ"><div className="admin-project-cell"><span>{item.projectId}</span><strong>{item.projectTitle}</strong><small>{item.issuingAgency} · อยู่ในคิวตรวจสอบ</small></div></td><td data-label="ความมั่นใจ"><div className="admin-confidence-cell"><b className={`admin-confidence-badge is-${confidenceTone(item.confidenceScore)}`}>{percent(item.confidenceScore)} <span>Confidence</span></b></div></td><td data-label="สาเหตุที่ต้องตรวจสอบ"><div className="admin-reason-list">{item.reviewReasons.map((reason) => <span key={reason}>{reasonLabel[reason] || reason}</span>)}</div></td><td data-label="สถานะ"><span className={`admin-processing-status is-${item.processingStatus}`}>{processingLabel(item.processingStatus)}</span></td><td data-label="การดำเนินการ"><div className="admin-row-actions"><button type="button" disabled={Boolean(reviewingProject)} onClick={() => reviewTor(item.projectId, true)}>{reviewingProject === item.projectId ? "กำลังบันทึก…" : "ยืนยันเป็น Software"}</button><button type="button" className="is-secondary" disabled={Boolean(reviewingProject)} onClick={() => reviewTor(item.projectId, false)}>ไม่ใช่ Software</button></div></td></tr>)}{!queueLoading && visibleItems.length === 0 && <tr><td className="admin-review-empty" colSpan="5"><strong>{queueError || "ไม่มีรายการที่ตรงกับตัวกรอง"}</strong><span>{queueError ? "โปรดตรวจสอบการเข้าสู่ระบบผู้ดูแล" : "ไม่มี TOR ที่มีความมั่นใจต่ำในขณะนี้"}</span></td></tr>}</tbody></table></div>
      {!queueLoading && !queueError && queueTotal > QUEUE_PAGE_SIZE && <nav className="analytics-pagination admin-review-pagination" aria-label="เปลี่ยนหน้าคิวตรวจสอบ"><button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>ก่อนหน้า</button><span>หน้า {page.toLocaleString("th-TH")} / {totalPages.toLocaleString("th-TH")}</span><button type="button" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>ถัดไป</button></nav>}
      <footer className="admin-review-footer"><span><i aria-hidden="true">●</i> ข้อมูลและการตัดสินใจ TOR เชื่อมต่อกับระบบจริงแล้ว · การนำเข้าข้อมูลยังไม่ได้เชื่อมต่อ</span></footer>
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
