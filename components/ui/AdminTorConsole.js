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

export default function AdminTorConsole({ projects }) {
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
          <div className="admin-tor-meta"><span>งบประมาณ</span><strong>{project.budget.toLocaleString("th-TH")} บาท</strong></div>
          <div className="admin-tor-state"><span className={extracted ? "is-ready" : "is-pending"}>{extracted ? "ข้อมูลเอกสารพร้อมใช้" : "รอข้อมูลเอกสาร"}</span><span>{project.version_info.is_latest ? `ฉบับล่าสุด v${project.version_info.version}` : `มีฉบับใหม่ v${project.version_info.version}`}</span><span>{project.processing?.status}</span></div>
          <div className="admin-tor-actions"><Link href={`/tors/${project.project_id}`}>ดูรายละเอียด</Link><button type="button" onClick={() => togglePublished(project.project_id)}>เข้าคิวประมวลผล</button></div>
        </article>;
      })}{visibleProjects.length === 0 && <p className="admin-empty">ไม่พบรายการที่ตรงกับตัวกรอง</p>}</div>
    </section>
  </div>;
}
