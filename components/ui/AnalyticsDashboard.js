"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AnalyticsExportButtons from "@/components/ui/AnalyticsExportButtons";
import { getAnalyticsOverview } from "@/lib/services/tor-service";

const BIDDING_LABELS = { open: "เปิดรับ", closed: "ปิดรับ", cancelled: "ยกเลิก", unknown: "ยังไม่ทราบ" };

function formatMoney(value) {
  if (value == null) return "ยังไม่ระบุมูลค่า";
  return `${(Number(value || 0) / 1_000_000).toLocaleString("th-TH", { maximumFractionDigits: 1 })} ล้านบาท`;
}

function closingLabel(value) {
  if (!value) return "ยังไม่ระบุ";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "ยังไม่ระบุ";
  return new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function emptyState() {
  return {
    metrics: { totalTors: 0, openForBidding: 0, openBudget: 0, closingSoon: 0, totalBudget: 0 },
    charts: { fiscalYearTrend: [], projectLength: [], biddingStatus: [], closingWindow: [], documentReadiness: [], topAgencies: [] },
    facets: { agencies: [], fiscalYears: [] },
    data: [], total: 0, page: 1, limit: 10, dataQuality: {},
  };
}

export default function AnalyticsDashboard() {
  const [softwareOnly, setSoftwareOnly] = useState(true);
  const [agency, setAgency] = useState("ทั้งหมด");
  const [biddingStatus, setBiddingStatus] = useState("ทั้งหมด");
  const [fiscalYearFilter, setFiscalYearFilter] = useState("ทั้งหมด");
  const [chartMode, setChartMode] = useState("budget");
  const [page, setPage] = useState(1);
  const [analytics, setAnalytics] = useState(emptyState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const query = useMemo(() => ({
    ...(softwareOnly ? { isSoftware: true } : {}),
    ...(agency !== "ทั้งหมด" ? { agency } : {}),
    ...(biddingStatus !== "ทั้งหมด" ? { biddingStatus } : {}),
    ...(fiscalYearFilter !== "ทั้งหมด" ? { fiscalYear: fiscalYearFilter } : {}),
    page,
    limit: 10,
  }), [agency, biddingStatus, fiscalYearFilter, page, softwareOnly]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    getAnalyticsOverview(query)
      .then((response) => { if (active) setAnalytics(response); })
      .catch(() => { if (active) setError("ไม่สามารถโหลดข้อมูลวิเคราะห์ได้ในขณะนี้"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [query]);

  const documentChart = chartMode === "documents";
  const chartItems = documentChart ? analytics.charts.documentReadiness : analytics.charts.fiscalYearTrend;
  const chartMaximum = Math.max(1, ...chartItems.map((item) => documentChart ? item.count : chartMode === "budget" ? item.totalBudget : item.count));
  const totalPages = Math.max(1, Math.ceil(analytics.total / analytics.limit));
  const openBudgetAmount = analytics.metrics.openBudget == null ? null : (Number(analytics.metrics.openBudget || 0) / 1_000_000).toLocaleString("th-TH", { maximumFractionDigits: 1 });
  const resetPage = () => setPage(1);
  const updateSoftwareOnly = () => { setSoftwareOnly((current) => !current); setAgency("ทั้งหมด"); resetPage(); };
  const clearFilters = () => {
    setAgency("ทั้งหมด"); setBiddingStatus("ทั้งหมด"); setFiscalYearFilter("ทั้งหมด"); setSoftwareOnly(true); resetPage();
  };

  return <div className="analytics-page analytics-studio">
    <section className="analytics-studio-header">
      <div><p>ตลาด TOR ภาครัฐ</p><h1>ภาพรวมโอกาสยื่นข้อเสนอ</h1><span>ดูมูลค่าโครงการ สถานะ TOR และช่วงเวลาที่ควรตัดสินใจในมุมเดียว</span></div>
      <div className="analytics-header-actions"><span className="analytics-period-label">{fiscalYearFilter === "ทั้งหมด" ? "ทุกปีงบประมาณ" : `ปีงบประมาณ ${fiscalYearFilter}`}</span><AnalyticsExportButtons query={query} /></div>
    </section>

    <section className="analytics-filters analytics-studio-filters" aria-label="ตัวกรองข้อมูลวิเคราะห์">
      <button type="button" className={`software-filter ${softwareOnly ? "is-active" : ""}`} onClick={updateSoftwareOnly} aria-pressed={softwareOnly}>ซอฟต์แวร์ / ไอที</button>
      <label><span>หน่วยงาน</span><select value={agency} onChange={(event) => { setAgency(event.target.value); resetPage(); }}><option value="ทั้งหมด">ทุกหน่วยงาน</option>{analytics.facets.agencies.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label>
      <label><span>สถานะการยื่นข้อเสนอ</span><select value={biddingStatus} onChange={(event) => { setBiddingStatus(event.target.value); resetPage(); }}><option value="ทั้งหมด">ทุกสถานะ</option><option value="open">เปิดรับ</option><option value="closed">ปิดรับ</option><option value="unknown">ยังไม่ทราบ</option><option value="cancelled">ยกเลิก</option></select></label>
      <label><span>ปีงบประมาณ</span><select value={fiscalYearFilter} onChange={(event) => { setFiscalYearFilter(event.target.value); resetPage(); }}><option value="ทั้งหมด">ทุกปีงบประมาณ</option>{analytics.facets.fiscalYears.map((item) => <option key={item.year} value={item.year}>ปีงบประมาณ {item.year}</option>)}</select></label>
      <button type="button" className="analytics-clear-filter" onClick={clearFilters}>ล้างตัวกรอง</button>
    </section>

    <p className="analytics-data-note">วิเคราะห์เฉพาะโครงการที่มีข้อมูล tender โดยสถานะและวันปิดรับคำนวณจากกำหนดเวลายื่นข้อเสนอจริง ส่วนมูลค่าใช้ราคากลางเมื่อยังไม่มีงบประมาณโครงการ</p>
    {error ? <p className="analytics-api-error" role="alert">{error}</p> : null}

    <section className="analytics-studio-grid" aria-label="ภาพรวมข้อมูลวิเคราะห์" aria-busy={loading}>
      <aside className="analytics-insight-stack">
        <article className="analytics-focus-card"><span>TOR ตามตัวกรอง</span><strong>{analytics.metrics.totalTors.toLocaleString("th-TH")}</strong><small>รายการที่กำลังวิเคราะห์</small></article>
        <article className="analytics-focus-card is-open"><span>กำลังเปิดรับ</span><strong>{analytics.metrics.openForBidding.toLocaleString("th-TH")}</strong><small>อ้างอิงจากสถานะปัจจุบัน</small></article>
        <article className="analytics-focus-card is-warning"><span>ปิดรับภายใน 7 วัน</span><strong>{analytics.metrics.closingSoon.toLocaleString("th-TH")}</strong><small>คำนวณจากเวลาปิดรับข้อเสนอ</small></article>
      </aside>

      <section className="analytics-main-chart">
        <div className="analytics-chart-heading"><div><p>{documentChart ? "เอกสาร" : "แนวโน้มงบประมาณ"}</p><h2>{documentChart ? "ความพร้อมของเอกสาร TOR" : "TOR ตามปีงบประมาณ"}</h2></div><div className="analytics-chart-switch" aria-label="รูปแบบกราฟ"><button type="button" className={chartMode === "budget" ? "is-active" : ""} onClick={() => setChartMode("budget")}>งบประมาณ</button><button type="button" className={chartMode === "count" ? "is-active" : ""} onClick={() => setChartMode("count")}>จำนวนโครงการ</button><button type="button" className={documentChart ? "is-active" : ""} onClick={() => setChartMode("documents")}>ความพร้อมเอกสาร</button></div></div>
        {chartItems.length ? <><div className="analytics-readiness-chart" data-mode={chartMode}>{chartItems.map((item) => { const value = documentChart ? item.count : chartMode === "budget" ? item.totalBudget : item.count; const key = documentChart ? item.key : item.fiscalYear; const label = documentChart ? item.label : `พ.ศ. ${item.fiscalYear}`; const valueLabel = documentChart || chartMode === "count" ? `${value.toLocaleString("th-TH")} โครงการ` : formatMoney(value); return <div key={key} className="analytics-readiness-column"><strong>{valueLabel}</strong><div className="analytics-readiness-bar" aria-label={`${label}: ${valueLabel}`}><i style={{ height: `${Math.max(8, (value / chartMaximum) * 100)}%` }} /></div><span>{label}</span></div>; })}</div><p className="analytics-chart-caption">{documentChart ? "ตรวจจากสถานะเอกสารที่เชื่อมกับโครงการ" : chartMode === "budget" ? "มูลค่างบประมาณรวมของ TOR ตามตัวกรอง" : "จำนวน TOR ตามตัวกรอง"}</p></> : <p className="analytics-empty">{documentChart ? "ยังไม่มีข้อมูลเอกสารสำหรับจัดกลุ่ม" : "ยังไม่มีวันที่เพียงพอสำหรับจัดกลุ่มปีงบประมาณ"}</p>}
        <div className="analytics-length-grid">{analytics.charts.projectLength.map((item) => <div key={item.key}><span>{item.label}</span><strong>{item.count.toLocaleString("th-TH")} โครงการ</strong><small>รวม {formatMoney(item.totalBudget)}</small></div>)}</div>
      </section>

      <aside className="analytics-bidding-panel">
        <p>มูลค่า TOR ที่เปิดรับ</p><strong className="analytics-money-value">{openBudgetAmount == null ? "ยังไม่ระบุมูลค่า" : <><span>{openBudgetAmount}</span><small>ล้านบาท</small></>}</strong><span>คำนวณจากรายการที่เปิดรับตามตัวกรอง</span>
        <div className="analytics-breakdown"><h2>สถานะการยื่นข้อเสนอ</h2>{analytics.charts.biddingStatus.map((item) => <div key={item.key}><span>{BIDDING_LABELS[item.key] ?? item.key}</span><b>{item.count.toLocaleString("th-TH")}</b></div>)}</div>
        <div className="analytics-breakdown"><h2>ระยะเวลาถึงวันปิดรับ</h2>{analytics.charts.closingWindow.map((item) => <div key={item.key}><span>{item.label}</span><b>{item.count.toLocaleString("th-TH")}</b></div>)}</div>
      </aside>
    </section>

    <section className="analytics-agency-card"><div className="analytics-chart-heading"><div><p>หน่วยงาน</p><h2>หน่วยงานที่มีมูลค่า TOR สูงสุด</h2></div><span>งบรวม {formatMoney(analytics.metrics.totalBudget)}</span></div><div className="analytics-bars">{analytics.charts.topAgencies.map((item) => <div className="analytics-bar-row" key={item.name}><div><strong>{item.name}</strong><span>{formatMoney(item.totalBudget)}</span></div><div className="analytics-bar-track"><i style={{ width: `${(item.totalBudget / (analytics.charts.topAgencies[0]?.totalBudget || 1)) * 100}%` }} /></div></div>)}</div></section>

    <section className="analytics-opportunities"><div className="analytics-chart-heading"><div><p>รายการเพื่อพิจารณา</p><h2>TOR ตามตัวกรอง</h2></div><span>แสดง {analytics.data.length.toLocaleString("th-TH")} จาก {analytics.total.toLocaleString("th-TH")} โครงการ</span></div>{analytics.data.length ? <div className="analytics-opportunity-list">{analytics.data.map((project) => <Link href={`/tors/${project.id}`} key={project.id} className="analytics-opportunity-row"><div><span className="analytics-project-id">{project.id}</span><h3>{project.title}</h3><p>{project.agency}</p></div><div><span>งบประมาณ / ราคากลาง</span><strong>{formatMoney(project.budget)}</strong></div><div><span>ปิดรับข้อเสนอ</span><strong>{closingLabel(project.bidClosesAt)}</strong></div><div className="analytics-row-badges"><b className={`is-${project.biddingStatus}`}>{BIDDING_LABELS[project.biddingStatus]}</b></div></Link>)}</div> : <p className="analytics-empty">{loading ? "กำลังโหลดข้อมูลวิเคราะห์..." : "ไม่พบ TOR ที่ตรงกับตัวกรอง"}</p>}
      {analytics.total > analytics.limit ? <nav className="analytics-pagination" aria-label="เปลี่ยนหน้ารายการ TOR"><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}>ก่อนหน้า</button><span>หน้า {page.toLocaleString("th-TH")} / {totalPages.toLocaleString("th-TH")}</span><button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((current) => current + 1)}>ถัดไป</button></nav> : null}
    </section>
  </div>;
}
