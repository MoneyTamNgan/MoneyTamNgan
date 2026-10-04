"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { listTorCards, listTorFacets } from "@/lib/services/tor-service";
import type { TorApiListItem } from "@/types/tor";

type DashboardTor = TorApiListItem;
type SortOption = "newest" | "budget-high" | "budget-low" | "best-match";
const DASHBOARD_PAGE_SIZE = 10;
const TOR_STAGES = [
  { value: "ทั้งหมด", label: "ทุกสถานะ TOR" },
  { value: "draft", label: "ร่าง TOR" },
  { value: "official", label: "TOR ฉบับจริง" },
  { value: "review", label: "อยู่ระหว่างพิจารณาผล" },
  { value: "closed", label: "ยกเลิก / ลงนามสัญญาแล้ว" },
];

const informationSlides = [
  { kicker: "ติดตาม TOR ได้ในที่เดียว", title: "ค้นหาโครงการจากหน่วยงานภาครัฐ", description: "รวมข้อมูล TOR พร้อมสถานะเอกสารและวันเผยแพร่ล่าสุด", accent: "ค้นหารายการ TOR" },
  { kicker: "อ่านข้อมูลได้รวดเร็วขึ้น", title: "สรุปคุณสมบัติและเทคโนโลยีที่ต้องการ", description: "เมื่อมีข้อมูลเอกสาร ระบบจะแสดงข้อมูลที่สรุปได้เพื่อช่วยให้คุณประเมินโครงการ", accent: "ดูข้อมูลเอกสาร" },
  { kicker: "เปรียบเทียบอย่างรอบคอบ", title: "ติดตามงบประมาณและข้อมูลความผิดปกติ", description: "แสดงข้อมูลเปรียบเทียบเมื่อมีข้อมูลเพียงพอ โดยผลลัพธ์เป็นข้อมูลประกอบการพิจารณาเท่านั้น", accent: "ดูข้อมูลวิเคราะห์" },
];

function formatDate(date: string | null) {
  if (!date) return "ยังไม่มีข้อมูล";
  return new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Bangkok" }).format(new Date(date));
}

function fiscalYears(contractStart: string | null, contractEnd: string | null) {
  if (!contractStart) return "ยังไม่ระบุปีงบประมาณ";
  const start = new Date(contractStart);
  if (Number.isNaN(start.getTime())) return "ยังไม่ระบุปีงบประมาณ";

  const fiscalYearFor = (date: Date) => date.getUTCFullYear() + 543 + (date.getUTCMonth() >= 9 ? 1 : 0);
  const firstYear = fiscalYearFor(start);
  const end = contractEnd ? new Date(contractEnd) : null;
  const lastYear = end && !Number.isNaN(end.getTime()) && end >= start ? fiscalYearFor(end) : firstYear;
  return firstYear === lastYear
    ? `ปีงบประมาณ ${firstYear}`
    : `ปีงบประมาณ ${firstYear}–${lastYear}`;
}

function projectStage(contractStart: string | null) {
  if (!contractStart) return { label: "ร่าง TOR", tone: "draft" };
  const millisecondsUntilStart = new Date(contractStart).getTime() - Date.now();
  if (Number.isNaN(millisecondsUntilStart)) return { label: "ร่าง TOR", tone: "draft" };
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  if (millisecondsUntilStart > thirtyDays) return { label: "TOR ฉบับจริง", tone: "official" };
  if (millisecondsUntilStart >= -thirtyDays) return { label: "อยู่ระหว่างพิจารณาผล / ประกาศผู้ชนะ", tone: "review" };
  return { label: "ยกเลิกโครงการ / ลงนามสัญญาแล้ว", tone: "closed" };
}

function biddingStatus(status: string) {
  const normalized = status.trim().toLowerCase();
  if (["cancelled", "ยกเลิก"].includes(normalized)) return { label: "ยกเลิก", tone: "cancelled" };
  if (["superseded", "invalid", "มีฉบับใหม่", "ไม่ถูกต้อง", "ปิดรับ", "ปิดรับแล้ว"].includes(normalized)) return { label: "ปิดรับ", tone: "closed" };
  return { label: "เปิดรับ", tone: "open" };
}

function biddingTimeRemaining(contractEnd: string | null) {
  if (!contractEnd) return { label: "ยังไม่ระบุวันสิ้นสุด", tone: "unknown" };
  const millisecondsLeft = new Date(contractEnd).getTime() - Date.now();
  if (Number.isNaN(millisecondsLeft)) return { label: "ยังไม่ระบุวันสิ้นสุด", tone: "unknown" };
  if (millisecondsLeft <= 0) return { label: "หมดเวลาแล้ว", tone: "expired" };
  const hoursLeft = Math.ceil(millisecondsLeft / (1000 * 60 * 60));
  if (hoursLeft < 24) return { label: `เหลือ ${hoursLeft} ชั่วโมง`, tone: "urgent" };
  const daysLeft = Math.ceil(hoursLeft / 24);
  return { label: `เหลือ ${daysLeft} วัน`, tone: daysLeft <= 7 ? "urgent" : "open" };
}

export default function DashboardPage() {
  const [items, setItems] = useState<DashboardTor[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [agencies, setAgencies] = useState<string[]>(["ทั้งหมด"]);
  const [agency, setAgency] = useState("ทั้งหมด");
  const [stage, setStage] = useState("ทั้งหมด");
  const [softwareOnly, setSoftwareOnly] = useState(true);
  const [sortBy, setSortBy] = useState<SortOption>("newest");
  const [activeSlide, setActiveSlide] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showStickyTools, setShowStickyTools] = useState(false);
  const filterBarRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadFeed() {
      setLoading(true);
      setError("");
      try {
        const result = await listTorCards({
          isSoftware: softwareOnly ? true : undefined,
          page,
          pageSize: DASHBOARD_PAGE_SIZE,
          agency: agency === "ทั้งหมด" ? undefined : agency,
          stage: stage === "ทั้งหมด" ? undefined : stage as "draft" | "official" | "review" | "closed",
        });
        if (!cancelled) {
          setItems(result.data);
          setTotal(result.total);
        }
      } catch {
        if (!cancelled) setError("ไม่สามารถโหลดรายการ TOR ได้ในขณะนี้");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadFeed();
    return () => { cancelled = true; };
  }, [agency, page, softwareOnly, stage]);

  useEffect(() => {
    let cancelled = false;
    void listTorFacets({ isSoftware: softwareOnly ? true : undefined }).then((result) => {
      if (!cancelled) setAgencies(["ทั้งหมด", ...result.agencies.map((item) => item.name)]);
    }).catch(() => {
      if (!cancelled) setAgencies(["ทั้งหมด"]);
    });
    return () => { cancelled = true; };
  }, [softwareOnly]);

  useEffect(() => {
    const timer = window.setInterval(() => setActiveSlide((current) => (current + 1) % informationSlides.length), 5_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const updateStickyTools = () => setShowStickyTools((filterBarRef.current?.getBoundingClientRect().bottom ?? 0) < 0);
    window.addEventListener("scroll", updateStickyTools, { passive: true });
    updateStickyTools();
    return () => window.removeEventListener("scroll", updateStickyTools);
  }, []);

  const visibleItems = useMemo(() => items.filter((tor) => {
    const allText = `${tor.id} ${tor.title} ${tor.agency} ${tor.techStack.join(" ")}`.toLowerCase();
    return allText.includes(query.toLowerCase());
  }).sort((first, second) => {
    if (sortBy === "best-match") return (second.matchScore ?? 0) - (first.matchScore ?? 0);
    if (sortBy === "budget-high") return second.budget - first.budget;
    if (sortBy === "budget-low") return first.budget - second.budget;
    return new Date(second.announceDate ?? 0).getTime() - new Date(first.announceDate ?? 0).getTime();
  }), [items, query, sortBy]);
  const totalPages = Math.max(1, Math.ceil(total / DASHBOARD_PAGE_SIZE));
  const updateAgency = (value: string) => { setAgency(value); setPage(1); };
  const updateStage = (value: string) => { setStage(value); setPage(1); };
  const updateSoftwareOnly = () => { setSoftwareOnly((current) => !current); setAgency("ทั้งหมด"); setPage(1); };

  return <main className="tor-feed"><style jsx global>{`.feed-card{min-height:440px!important;transition:border-color .18s ease,background .18s ease,box-shadow .18s ease!important}.feed-card .anomaly-slot{display:flex;align-items:center;min-height:44px}.feed-card .budget-warning{margin:0}.feed-card .anomaly-clear{color:#8ea89d;font-size:.79rem}.feed-card .feed-budget{min-height:68px;margin:0 0 10px}.feed-card .document-availability{display:flex;align-items:center;justify-content:space-between;min-height:38px;padding:8px 0;border-bottom:1px solid #2b4a52;color:#a7bdb5;font-size:.8rem}.feed-card .document-availability strong{color:#b8dccc;font-size:.82rem}.feed-card .technology-tags{align-content:flex-start;min-height:64px;max-height:64px;overflow:hidden;padding-top:12px}.feed-card footer{min-height:48px;border-top:1px solid #2b4a52}@media (hover:hover) and (min-width:651px){.feed-card:hover{z-index:5!important;transform:none!important;border-color:var(--orange-primary)!important;background:var(--cream-soft)!important;box-shadow:0 26px 42px var(--shadow)!important}}`}</style>
    <style jsx global>{`.feed-card-bottom{display:flex;flex-direction:column;margin-top:auto}.feed-card-bottom .anomaly-slot{display:flex;align-items:center;min-height:44px}.feed-card-bottom .feed-budget{min-height:68px;margin:0}.feed-card-bottom .technology-tags{align-content:flex-start;min-height:64px;max-height:64px;overflow:hidden;margin:0;padding-top:12px}.feed-card-bottom footer{min-height:48px;margin-top:0;padding-top:16px;border-top:1px solid #2b4a52}`}</style>

        {showStickyTools && <div className="dashboard-sticky-tools" aria-label="ค้นหาและตัวกรอง TOR"><div className="dashboard-sticky-tools-inner"><label className="dashboard-sticky-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหา TOR" aria-label="ค้นหา TOR" /></label><button type="button" className={`software-filter ${softwareOnly ? "is-active" : ""}`} onClick={updateSoftwareOnly} aria-pressed={softwareOnly}>ซอฟต์แวร์ / ไอที</button><label><span className="sr-only">หน่วยงาน</span><select value={agency} onChange={(event) => updateAgency(event.target.value)}>{agencies.map((name) => <option value={name} key={name}>{name === "ทั้งหมด" ? "ทุกหน่วยงาน" : name}</option>)}</select></label><label><span className="sr-only">สถานะ TOR</span><select value={stage} onChange={(event) => updateStage(event.target.value)}>{TOR_STAGES.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label><label><span className="sr-only">เรียงลำดับ</span><select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortOption)}><option value="newest">ล่าสุด</option><option value="budget-high">งบสูงไปต่ำ</option><option value="budget-low">งบต่ำไปสูง</option><option value="best-match">ตรงกับโปรไฟล์</option></select></label></div></div>}

    <section className="information-carousel" aria-label="ข้อมูลแนะนำ">
      <div className="information-track" style={{ transform: `translateX(-${activeSlide * 100}%)` }}>
        {informationSlides.map((slide, index) => <article className="information-slide" key={slide.title} aria-hidden={index !== activeSlide}>
          <div className="information-copy"><p>{slide.kicker}</p><h2>{slide.title}</h2><span>{slide.description}</span><strong>{slide.accent} <i aria-hidden="true">→</i></strong></div>
          <div className="information-image" aria-label="พื้นที่สำหรับภาพประกอบ"><svg viewBox="0 0 320 190" role="img" aria-label="ภาพตัวอย่าง"><rect x="8" y="8" width="304" height="174" rx="14" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="7 7" /><circle cx="106" cy="82" r="24" fill="currentColor" opacity=".25" /><path d="M38 154l62-49 41 34 48-58 93 73H38z" fill="currentColor" opacity=".42" /><path d="M208 49h57M208 65h39M208 81h48" stroke="currentColor" strokeLinecap="round" strokeWidth="6" opacity=".5" /></svg><span>ภาพประกอบตัวอย่าง</span></div>
        </article>)}
      </div>
      <div className="carousel-controls"><div>{informationSlides.map((slide, index) => <button className={index === activeSlide ? "is-active" : ""} type="button" key={slide.title} onClick={() => setActiveSlide(index)} aria-label={`แสดงสไลด์ ${index + 1}`} aria-current={index === activeSlide} />)}</div><span>เปลี่ยนข้อมูลอัตโนมัติทุก 5 วินาที</span></div>
    </section>

    <div className="feed-body">
      <section className="feed-heading"><div><p className="feed-kicker">TOR · ข้อมูลสาธารณะ</p><h1>โครงการที่อาจเหมาะกับคุณ</h1><p>ติดตาม TOR จากหน่วยงานภาครัฐ พร้อมข้อมูลคุณสมบัติ งบประมาณ และสถานะเอกสาร</p></div><div className="feed-total"><strong>{total.toLocaleString("th-TH")}</strong><span>โครงการทั้งหมด</span><small>กำลังแสดง {visibleItems.length} รายการ · หน้า {page} จาก {totalPages}</small></div></section>

      <label className="feed-search feed-search-main"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหารหัสโครงการ ชื่อ หน่วยงาน หรือเทคโนโลยี" aria-label="ค้นหา TOR" /></label>

      <section className="feed-filters" aria-label="ตัวกรอง TOR" ref={filterBarRef}>
        <div className="filter-title"><span aria-hidden="true">☷</span> ตัวกรอง</div>
        <button type="button" className={`software-filter ${softwareOnly ? "is-active" : ""}`} onClick={updateSoftwareOnly} aria-pressed={softwareOnly}>ซอฟต์แวร์ / ไอที</button>
        <label><span className="sr-only">หน่วยงาน</span><select value={agency} onChange={(event) => updateAgency(event.target.value)}>{agencies.map((name) => <option value={name} key={name}>{name === "ทั้งหมด" ? "ทุกหน่วยงาน" : name}</option>)}</select></label>
        <label><span className="sr-only">สถานะ TOR</span><select value={stage} onChange={(event) => updateStage(event.target.value)}>{TOR_STAGES.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
        <label className="sort-control"><span className="sr-only">เรียงลำดับ</span><select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortOption)}><option value="newest">เรียงตาม: ล่าสุด</option><option value="budget-high">งบประมาณ: สูงไปต่ำ</option><option value="budget-low">งบประมาณ: ต่ำไปสูง</option><option value="best-match">ความตรงกับโปรไฟล์</option></select></label>
      </section>

      <section className="feed-grid" aria-label="รายการ TOR">
        {loading && <p className="feed-empty">กำลังโหลดรายการ TOR…</p>}
        {error && <p className="feed-empty">{error}</p>}
        {!loading && !error && visibleItems.map((tor) => {
          const stage = projectStage(tor.contractStart);
          const status = biddingStatus(tor.projectStatus);
          const remainingTime = biddingTimeRemaining(tor.contractEnd);
          return <Link className="feed-card" href={`/tors/${tor.id}`} key={tor.id} onMouseLeave={(event) => event.currentTarget.scrollTo({ top: 0 })}>
          <div className="feed-card-top"><div className="feed-card-meta"><span>รหัสโครงการ {tor.id}</span></div><div className="bidding-signals"><span className={`bidding-badge bidding-countdown is-${remainingTime.tone}`} title="คำนวณชั่วคราวจากวันสิ้นสุดสัญญา">{remainingTime.label}</span><span className={`bidding-badge bidding-status is-${status.tone}`}>{status.label}</span></div></div>
          <h2>{tor.title}</h2><p className="feed-agency"><span aria-hidden="true">⌂</span>{tor.agency}</p>
          <div className="feed-card-bottom">
            <div className="anomaly-slot">{tor.anomaly.highBudgetFlag && <p className="budget-warning"><span aria-hidden="true">!</span> งบประมาณสูงผิดปกติเมื่อเทียบกับข้อมูลที่มี</p>}</div>
            <div className="project-stage-row"><span className={`feed-status project-stage stage-${stage.tone}`}><i aria-hidden="true" />{stage.label}</span></div>
            <div className="feed-card-metrics"><div className="feed-card-metric"><span>{fiscalYears(tor.contractStart, tor.contractEnd)}</span><strong>{tor.budget.toLocaleString("th-TH")} บาท</strong></div><div className="feed-card-metric"><span>ปิดรับข้อเสนอ</span><strong>{formatDate(tor.contractEnd)}</strong></div></div>
          </div>
        </Link>;
        })}
        {!loading && !error && visibleItems.length === 0 && <p className="feed-empty">ไม่พบโครงการที่ตรงกับตัวกรองที่เลือก</p>}
      </section>
      {!loading && !error && totalPages > 1 && <nav className="feed-pagination" aria-label="เปลี่ยนหน้ารายการ TOR">
        <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1}>← ก่อนหน้า</button>
        <label className="feed-page-input"><span className="sr-only">เลือกหน้า</span><input type="number" min="1" max={totalPages} value={page} onChange={(event) => setPage(Math.min(totalPages, Math.max(1, Number(event.target.value) || 1)))} aria-label="หน้าปัจจุบัน" /></label>
        <output aria-live="polite">จาก <strong>{totalPages}</strong> หน้า</output>
        <button type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page === totalPages}>ถัดไป →</button>
      </nav>}
    </div>
  </main>;
}
