"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const reasonLabel = { low_classification_confidence: "การจำแนกไม่ชัดเจน", low_extraction_confidence: "ข้อมูลเอกสารไม่ครบ" };
const QUEUE_PAGE_SIZE = 5;
const PIPELINE_STATUS_URL = "/api/admin/pipeline/status";
const PIPELINE_TRIGGER_URL = "/api/admin/pipeline/trigger";
// Safe defaults for a manual background pull.
const PIPELINE_TRIGGER_REQUEST = { limit: 5, allowBrowser: true, sync: false, force: false };
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

function pipelinePhaseLabel(phase) {
  return ({ starting: "กำลังเตรียมระบบ", discovery: "กำลังค้นหา TOR ใหม่", acquisition: "กำลังดาวน์โหลดเอกสาร", processing: "กำลังวิเคราะห์ข้อมูล", notification: "กำลังจับคู่และแจ้งเตือน", completed: "ดำเนินการเสร็จสิ้น" })[phase] || "กำลังเตรียมระบบ";
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
  const [pipeline, setPipeline] = useState({ loading: true, run: null, dbStats: null, error: "" });
  const [pipelineStarting, setPipelineStarting] = useState(false);
  const [pipelineRefreshToken, setPipelineRefreshToken] = useState(0);
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
    let refreshTimer;

    async function loadPipelineStatus() {
      try {
        const response = await fetch(PIPELINE_STATUS_URL);
        const result = await response.json();
        if (!response.ok) throw new Error(result.error?.message || "ไม่สามารถโหลดสถานะ Pipeline ได้");
        if (!active) return;
        setPipeline({ loading: false, run: result.run || null, dbStats: result.dbStats || null, error: "" });
        if (result.run?.status === "running") refreshTimer = window.setTimeout(loadPipelineStatus, 10000);
      } catch (error) {
        if (active) setPipeline({ loading: false, run: null, dbStats: null, error: error.message || "ไม่สามารถโหลดสถานะ Pipeline ได้" });
      }
    }

    void loadPipelineStatus();
    return () => { active = false; window.clearTimeout(refreshTimer); };
  }, [pipelineRefreshToken]);

  useEffect(() => {
    function refreshWhenAdminTabOpens() {
      if (document.visibilityState !== "visible") return;
      setPipelineRefreshToken((current) => current + 1);
    }

    window.addEventListener("focus", refreshWhenAdminTabOpens);
    document.addEventListener("visibilitychange", refreshWhenAdminTabOpens);
    return () => {
      window.removeEventListener("focus", refreshWhenAdminTabOpens);
      document.removeEventListener("visibilitychange", refreshWhenAdminTabOpens);
    };
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
  const pipelineIsRunning = pipeline.run?.status === "running";
  const pipelineProgress = pipeline.run?.progress;
  const pipelinePercent = Math.max(0, Math.min(100, Number(pipelineProgress?.percent) || 0));

  async function startPull() {
    setMessageTone("info");
    if (pipelineIsRunning) {
      setPullMessage(pipelineProgress?.message || "Pipeline กำลังทำงานอยู่ กำลังอัปเดตสถานะ…");
      return;
    }
    setPipelineStarting(true);
    setPullMessage("กำลังเริ่มต้น Pipeline นำเข้าข้อมูล…");
    try {
      const response = await fetch(PIPELINE_TRIGGER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(PIPELINE_TRIGGER_REQUEST),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 409 && result.currentRun) {
          setPipeline((current) => ({ ...current, loading: false, run: result.currentRun, error: "" }));
          setPipelineRefreshToken((current) => current + 1);
        }
        throw new Error(result.error?.message || "ไม่สามารถเริ่ม Pipeline ได้");
      }
      setPipeline((current) => ({ ...current, loading: false, run: result.run || null, error: "" }));
      setPipelineRefreshToken((current) => current + 1);
      setPullMessage("เริ่ม Pipeline แล้ว กำลังดึงข้อมูลและอัปเดตความคืบหน้า…");
    } catch (error) {
      setMessageTone("error");
      setPullMessage(error.message || "ไม่สามารถเริ่ม Pipeline ได้");
    } finally {
      setPipelineStarting(false);
    }
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
      <div className="admin-ops-hero-actions"><button className="admin-pull-button" type="button" onClick={startPull} disabled={pipeline.loading || pipelineStarting || pipelineIsRunning}><span aria-hidden="true">↓</span> {pipeline.loading ? "กำลังตรวจสอบ…" : pipelineStarting ? "กำลังเริ่มต้น…" : pipelineIsRunning ? `กำลังนำเข้า ${pipelinePercent}%` : "เริ่มนำเข้าข้อมูล"}</button>{pipelineIsRunning && <section className="admin-pipeline-progress" aria-live="polite" aria-label="ความคืบหน้าการนำเข้าข้อมูล"><div className="admin-pipeline-progress-title"><div><span>PIPELINE กำลังทำงาน</span><strong>{pipelinePhaseLabel(pipeline.run?.phase)}</strong></div><b>{pipelinePercent}%</b></div><div className="admin-pipeline-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={pipelinePercent}><i style={{ width: `${pipelinePercent}%` }} /></div><small>{pipelineProgress?.message || "กำลังอัปเดตความคืบหน้า…"}{pipelineProgress?.total ? ` · ${pipelineProgress.current || 0}/${pipelineProgress.total} รายการ` : ""}</small></section>}</div>
    </section>
    {(pullMessage || operations.error || pipeline.error) && <p className={`admin-ops-live-message is-visible is-${operations.error || pipeline.error ? "error" : messageTone}`} role="status" aria-live="polite">{pullMessage || operations.error || pipeline.error}</p>}
    <section className="admin-ops-metrics" aria-label="สถานะการนำเข้าข้อมูล">
      <article className="admin-ops-metric"><div className="admin-ops-metric-icon is-calendar" aria-hidden="true">◷</div><div><span>นำเข้าข้อมูลอัตโนมัติล่าสุด</span><strong>{operations.loading ? "กำลังโหลด…" : formatBangkokDateTime(operations.lastRun?.finished_at || operations.lastRun?.started_at)}</strong><small>{operations.lastRun?.status === "succeeded" ? "ทำงานตามกำหนดเวลา" : "อ้างอิงจากรอบการนำเข้าล่าสุด"}</small></div></article>
      <article className="admin-ops-metric"><div className="admin-ops-metric-icon is-projects" aria-hidden="true">▦</div><div><span>โครงการที่นำเข้าแล้ว</span><strong>{operations.loading ? "…" : (operations.totalProjects ?? pipeline.dbStats?.totalProjects ?? 0).toLocaleString("th-TH")} <em>รายการ</em></strong><small>{operations.lastRun?.stored_count != null ? `จัดเก็บ ${operations.lastRun.stored_count.toLocaleString("th-TH")} รายการในรอบล่าสุด` : pipeline.dbStats?.withSummary != null ? `มีสรุปผลแล้ว ${pipeline.dbStats.withSummary.toLocaleString("th-TH")} รายการ` : "กำลังรอข้อมูลรอบล่าสุด"}</small></div></article>
      <article className={`admin-ops-metric is-${health.tone}`}><div className="admin-ops-metric-icon is-health" aria-hidden="true">{health.tone === "healthy" ? "✓" : "!"}</div><div><span>สุขภาพการดึงข้อมูล</span><strong>{operations.loading ? "กำลังตรวจสอบ…" : health.label}</strong><small><i aria-hidden="true" /> {operations.loading ? "กำลังโหลดสถานะระบบ" : health.detail}</small></div></article>
    </section>
    <section className="admin-review-panel">
      <header className="admin-review-heading"><div><p>REVIEW QUEUE</p><h2>รายการที่ต้องตรวจสอบ</h2><span>ความมั่นใจต่ำกว่า 70% จะถูกส่งมาที่นี่เพื่อให้ผู้ดูแลยืนยันผลก่อนใช้งานต่อ</span></div><div className="admin-review-count"><strong>{queueLoading ? "…" : queueTotal.toLocaleString("th-TH")}</strong><span>{queueLoading ? "กำลังโหลดรายการ" : `แสดง ${queue.length.toLocaleString("th-TH")} จาก ${queueTotal.toLocaleString("th-TH")}`}</span></div></header>
      <div className="admin-review-controls"><label className="admin-review-search"><span aria-hidden="true">⌕</span><input aria-label="ค้นหารายการ TOR" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} /></label><label className="admin-review-filter"><select aria-label="สาเหตุที่ต้องตรวจสอบ" value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1); }}><option value="all">ทุกสาเหตุ</option><option value="classification">การจำแนกไม่ชัดเจน</option><option value="extraction">ข้อมูลเอกสารไม่ครบ</option></select></label></div>
      <div className="admin-review-table-wrap"><table className="admin-review-table"><thead><tr><th scope="col">โครงการ</th><th scope="col">ความมั่นใจ</th><th scope="col">สาเหตุที่ต้องตรวจสอบ</th><th scope="col">สถานะ</th><th scope="col"><span className="sr-only">การดำเนินการ</span></th></tr></thead><tbody>{queueLoading && <tr><td className="admin-review-empty" colSpan="5"><strong>กำลังโหลดคิวตรวจสอบ…</strong></td></tr>}{!queueLoading && visibleItems.map((item) => <tr key={item.projectId}><td data-label="โครงการ"><div className="admin-project-cell"><span>{item.projectId}</span><strong>{item.projectTitle}</strong><small>{item.issuingAgency} · อยู่ในคิวตรวจสอบ</small></div></td><td data-label="ความมั่นใจ"><div className="admin-confidence-cell"><b className={`admin-confidence-badge is-${confidenceTone(item.confidenceScore)}`}>{percent(item.confidenceScore)} <span>Confidence</span></b></div></td><td data-label="สาเหตุที่ต้องตรวจสอบ"><div className="admin-reason-list">{item.reviewReasons.map((reason) => <span key={reason}>{reasonLabel[reason] || reason}</span>)}</div></td><td data-label="สถานะ"><span className={`admin-processing-status is-${item.processingStatus}`}>{processingLabel(item.processingStatus)}</span></td><td data-label="การดำเนินการ"><div className="admin-row-actions"><button type="button" disabled={Boolean(reviewingProject)} onClick={() => reviewTor(item.projectId, true)}>{reviewingProject === item.projectId ? "กำลังบันทึก…" : "ยืนยันเป็น Software"}</button><button type="button" className="is-secondary" disabled={Boolean(reviewingProject)} onClick={() => reviewTor(item.projectId, false)}>ไม่ใช่ Software</button></div></td></tr>)}{!queueLoading && visibleItems.length === 0 && <tr><td className="admin-review-empty" colSpan="5"><strong>{queueError || "ไม่มีรายการที่ตรงกับตัวกรอง"}</strong><span>{queueError ? "โปรดตรวจสอบการเข้าสู่ระบบผู้ดูแล" : "ไม่มี TOR ที่มีความมั่นใจต่ำในขณะนี้"}</span></td></tr>}</tbody></table></div>
      {!queueLoading && !queueError && queueTotal > QUEUE_PAGE_SIZE && <nav className="analytics-pagination admin-review-pagination" aria-label="เปลี่ยนหน้าคิวตรวจสอบ"><button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>ก่อนหน้า</button><span>หน้า {page.toLocaleString("th-TH")} / {totalPages.toLocaleString("th-TH")}</span><button type="button" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>ถัดไป</button></nav>}
    </section>
  </div>;
}
