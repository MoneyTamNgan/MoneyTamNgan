"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { listTorCards } from "@/lib/services/tor-service";
import type { TorApiListItem } from "@/types/tor";

type DashboardTor = TorApiListItem;
type SortOption = "newest" | "budget-high" | "budget-low" | "best-match";

const informationSlides = [
  { kicker: "ติดตาม TOR ได้ในที่เดียว", title: "ค้นหาโครงการจากหน่วยงานภาครัฐ", description: "รวมข้อมูล TOR พร้อมสถานะเอกสารและวันเผยแพร่ล่าสุด", accent: "ค้นหารายการ TOR" },
  { kicker: "อ่านข้อมูลได้รวดเร็วขึ้น", title: "สรุปคุณสมบัติและเทคโนโลยีที่ต้องการ", description: "เมื่อมีข้อมูลเอกสาร ระบบจะแสดงข้อมูลที่สรุปได้เพื่อช่วยให้คุณประเมินโครงการ", accent: "ดูข้อมูลเอกสาร" },
  { kicker: "เปรียบเทียบอย่างรอบคอบ", title: "ติดตามงบประมาณและข้อมูลความผิดปกติ", description: "แสดงข้อมูลเปรียบเทียบเมื่อมีข้อมูลเพียงพอ โดยผลลัพธ์เป็นข้อมูลประกอบการพิจารณาเท่านั้น", accent: "ดูข้อมูลวิเคราะห์" },
];

function formatDate(date: string | null) {
  if (!date) return "ยังไม่มีข้อมูล";
  return new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric" }).format(new Date(date));
}

function statusLabel(status: string) {
  return { Active: "กำลังใช้งาน", Superseded: "มีฉบับใหม่", Invalid: "ไม่ถูกต้อง", Cancelled: "ยกเลิก" }[status] ?? status;
}

export default function DashboardPage() {
  const [items, setItems] = useState<DashboardTor[]>([]);
  const [query, setQuery] = useState("");
  const [agency, setAgency] = useState("ทั้งหมด");
  const [technology, setTechnology] = useState("ทั้งหมด");
  const [sortBy, setSortBy] = useState<SortOption>("newest");
  const [activeSlide, setActiveSlide] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showStickyTools, setShowStickyTools] = useState(false);
  const [account, setAccount] = useState<{ id: string } | null | undefined>(undefined);
  const filterBarRef = useRef<HTMLElement>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setAccount(data?.user ?? null))
      .catch(() => setAccount(null));
  }, []);

  useEffect(() => {
    async function loadFeed() {
      try {
        const result = await listTorCards({ pageSize: 100 });
        setItems(result.data);
      } catch {
        setError("ไม่สามารถโหลดรายการ TOR ได้ในขณะนี้");
      } finally {
        setLoading(false);
      }
    }
    void loadFeed();
  }, []);

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

  const isGuest = account === null;
  const agencies = useMemo(() => ["ทั้งหมด", ...new Set(items.map((tor) => tor.agency))], [items]);
  const technologies = useMemo(() => ["ทั้งหมด", ...new Set(items.flatMap((tor) => tor.techStack))], [items]);
  const visibleItems = useMemo(() => items.filter((tor) => {
    const allText = `${tor.title} ${tor.agency} ${tor.techStack.join(" ")}`.toLowerCase();
    return allText.includes(query.toLowerCase()) && (agency === "ทั้งหมด" || tor.agency === agency) && (technology === "ทั้งหมด" || tor.techStack.includes(technology));
  }).sort((first, second) => {
    if (sortBy === "best-match") return (second.matchScore ?? 0) - (first.matchScore ?? 0);
    if (sortBy === "budget-high") return (second.budget ?? 0) - (first.budget ?? 0);
    if (sortBy === "budget-low") return (first.budget ?? 0) - (second.budget ?? 0);
    return new Date(second.announceDate ?? 0).getTime() - new Date(first.announceDate ?? 0).getTime();
  }), [agency, items, query, sortBy, technology]);

  return <main className="tor-feed"><style jsx global>{`.feed-card{min-height:475px!important;transition:transform .18s ease,border-color .18s ease,background .18s ease,box-shadow .18s ease!important}.feed-card .anomaly-slot{display:flex;align-items:center;min-height:44px}.feed-card .budget-warning{margin:0}.feed-card .anomaly-clear{color:#8ea89d;font-size:.79rem}.feed-card .feed-budget{min-height:68px;margin:0 0 10px}.feed-card .document-availability{display:flex;align-items:center;justify-content:space-between;min-height:38px;padding:8px 0;border-bottom:1px solid #2b4a52;color:#a7bdb5;font-size:.8rem}.feed-card .document-availability strong{color:#b8dccc;font-size:.82rem}.feed-card .technology-tags{align-content:flex-start;min-height:64px;max-height:64px;overflow:hidden;padding-top:12px}.feed-card footer{min-height:48px;border-top:1px solid #2b4a52}@media (hover:hover) and (min-width:651px){.feed-card:hover{z-index:5!important;transform:translateY(-8px) scale(1.025)!important;border-color:var(--orange-primary)!important;background:var(--cream-soft)!important;box-shadow:0 26px 42px var(--shadow)!important}}`}</style>
    <style jsx global>{`.feed-card-bottom{display:flex;flex-direction:column;margin-top:auto}.feed-card-bottom .anomaly-slot{display:flex;align-items:center;min-height:44px}.feed-card-bottom .feed-budget{min-height:68px;margin:0}.feed-card-bottom .technology-tags{align-content:flex-start;min-height:64px;max-height:64px;overflow:hidden;margin:0;padding-top:12px}.feed-card-bottom footer{min-height:48px;margin-top:0;padding-top:16px;border-top:1px solid #2b4a52}@media (hover:hover) and (min-width:651px){.feed-card{height:475px;max-height:475px;overflow-y:hidden;scrollbar-gutter:stable}.feed-card:hover{overflow-y:auto}.feed-card:hover .technology-tags{max-height:none;overflow:visible}.feed-card::-webkit-scrollbar{width:7px}.feed-card::-webkit-scrollbar-thumb{border-radius:999px;background:#5e9280}.feed-card::-webkit-scrollbar-track{background:transparent}}
    .guest-login-banner{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:24px;padding:18px 24px;border:1px solid var(--orange-primary,#e86f2a);border-radius:14px;background:linear-gradient(135deg,rgba(232,111,42,.08),rgba(255,247,237,.95));box-shadow:0 8px 22px var(--shadow,rgba(58,29,18,.12));animation:feed-reveal .4s ease both}
    .theme-mint .guest-login-banner{border-color:#8ee5b5;background:linear-gradient(135deg,rgba(23,57,65,.9),rgba(16,43,49,.95));box-shadow:0 8px 22px rgba(0,0,0,.25)}
    .guest-login-banner-content{display:flex;align-items:center;gap:16px}
    .guest-login-banner-icon{display:grid;place-items:center;width:44px;height:44px;border-radius:10px;background:var(--orange-primary,#e86f2a);color:#fff;font-size:1.25rem;flex-shrink:0}
    .theme-mint .guest-login-banner-icon{background:#174c3c;color:#a5f0c3}
    .guest-login-banner-text h3{margin:0 0 4px;font-size:1.08rem;font-weight:700;color:var(--ink,#2f1a12)}
    .theme-mint .guest-login-banner-text h3{color:#f1f9f5}
    .guest-login-banner-text p{margin:0;font-size:.88rem;color:var(--ink-secondary,#6f4b3d)}
    .theme-mint .guest-login-banner-text p{color:#adc2b9}
    .guest-login-banner-button{display:inline-flex;align-items:center;gap:8px;padding:10px 22px;border-radius:999px;background:var(--orange-primary,#e86f2a);color:#fff!important;font-size:.92rem;font-weight:700;text-decoration:none;white-space:nowrap;transition:transform .16s ease,background .16s ease,box-shadow .16s ease;box-shadow:0 4px 14px rgba(232,111,42,.3);flex-shrink:0}
    .guest-login-banner-button:hover{background:var(--orange-primary-hover,#c9551b);transform:translateY(-2px);box-shadow:0 6px 18px rgba(232,111,42,.4)}
    .theme-mint .guest-login-banner-button{background:#174c3c;color:#a5f0c3!important;border:1px solid #2f8a5a;box-shadow:0 4px 14px rgba(0,0,0,.2)}
    .theme-mint .guest-login-banner-button:hover{background:#1f5f4c;color:#fff!important}
    .feed-card-guest-hint{color:var(--orange-primary,#e86f2a);font-size:.82rem;font-weight:700;transition:color .16s ease}
    .theme-mint .feed-card-guest-hint{color:#a5f0c3}
    .feed-card:hover .feed-card-guest-hint{text-decoration:underline}
    .feed-card-view-hint{color:var(--ink-muted,#9a7465);font-size:.82rem;transition:color .16s ease}
    .feed-card:hover .feed-card-view-hint{color:var(--orange-primary,#e86f2a);text-decoration:underline}
    @media(max-width:650px){.guest-login-banner{flex-direction:column;align-items:stretch;gap:14px;padding:16px}.guest-login-banner-button{justify-content:center;width:100%}}`}</style>

        {showStickyTools && <div className="dashboard-sticky-tools" aria-label="ค้นหาและตัวกรอง TOR"><div className="dashboard-sticky-tools-inner"><label className="dashboard-sticky-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหา TOR" aria-label="ค้นหา TOR" /></label><label><span className="sr-only">หน่วยงาน</span><select value={agency} onChange={(event) => setAgency(event.target.value)}>{agencies.map((name) => <option value={name} key={name}>{name === "ทั้งหมด" ? "ทุกหน่วยงาน" : name}</option>)}</select></label><label><span className="sr-only">เทคโนโลยีหรือหมวดหมู่</span><select value={technology} onChange={(event) => setTechnology(event.target.value)}>{technologies.map((name) => <option value={name} key={name}>{name === "ทั้งหมด" ? "ทุกเทคโนโลยี" : name}</option>)}</select></label><label><span className="sr-only">เรียงลำดับ</span><select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortOption)}><option value="newest">ล่าสุด</option><option value="budget-high">งบสูงไปต่ำ</option><option value="budget-low">งบต่ำไปสูง</option><option value="best-match">ตรงกับโปรไฟล์</option></select></label></div></div>}

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
      <section className="feed-heading"><div><p className="feed-kicker">TOR · ข้อมูลสาธารณะ</p><h1>โครงการที่อาจเหมาะกับคุณ</h1><p>ติดตาม TOR จากหน่วยงานภาครัฐ พร้อมข้อมูลคุณสมบัติ งบประมาณ และสถานะเอกสาร</p></div><div className="feed-total"><strong>{visibleItems.length}</strong><span>โครงการที่พบ</span></div></section>

      {isGuest && (
        <aside className="guest-login-banner" role="status" aria-label="แจ้งเตือนการเข้าสู่ระบบ">
          <div className="guest-login-banner-content">
            <span className="guest-login-banner-icon" aria-hidden="true">🔒</span>
            <div className="guest-login-banner-text">
              <h3>เข้าสู่ระบบเพื่อดูรายละเอียดโครงการฉบับเต็ม</h3>
              <p>Log in to view full project detail · เข้าถึงข้อมูลเอกสาร TOR, ผลการสกัดข้อมูลเชิงลึก และคะแนนความตรงกับโปรไฟล์ของคุณ</p>
            </div>
          </div>
          <Link className="guest-login-banner-button" href="/?next=/dashboard">
            เข้าสู่ระบบ / Log in <span aria-hidden="true">→</span>
          </Link>
        </aside>
      )}

      <label className="feed-search feed-search-main"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาโครงการ หน่วยงาน หรือเทคโนโลยี" aria-label="ค้นหา TOR" /></label>

      <section className="feed-filters" aria-label="ตัวกรอง TOR" ref={filterBarRef}>
        <div className="filter-title"><span aria-hidden="true">☷</span> ตัวกรอง</div>
        <label><span className="sr-only">หน่วยงาน</span><select value={agency} onChange={(event) => setAgency(event.target.value)}>{agencies.map((name) => <option value={name} key={name}>{name === "ทั้งหมด" ? "ทุกหน่วยงาน" : name}</option>)}</select></label>
        <label><span className="sr-only">เทคโนโลยีหรือหมวดหมู่</span><select value={technology} onChange={(event) => setTechnology(event.target.value)}>{technologies.map((name) => <option value={name} key={name}>{name === "ทั้งหมด" ? "ทุกเทคโนโลยี" : name}</option>)}</select></label>
        <label className="sort-control"><span className="sr-only">เรียงลำดับ</span><select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortOption)}><option value="newest">เรียงตาม: ล่าสุด</option><option value="budget-high">งบประมาณ: สูงไปต่ำ</option><option value="budget-low">งบประมาณ: ต่ำไปสูง</option><option value="best-match">ความตรงกับโปรไฟล์</option></select></label>
      </section>

      <section className="feed-grid" aria-label="รายการ TOR">
        {loading && <p className="feed-empty">กำลังโหลดรายการ TOR…</p>}
        {error && <p className="feed-empty">{error}</p>}
        {!loading && !error && visibleItems.map((tor) => {
          const cardHref = isGuest ? `/?next=${encodeURIComponent(`/tors/${tor.id}`)}` : `/tors/${tor.id}`;
          return (
            <Link className="feed-card" href={cardHref} key={tor.id} onMouseLeave={(event) => event.currentTarget.scrollTo({ top: 0 })}>
              <div className="feed-card-top">
                <div className="feed-card-meta"><span>{formatDate(tor.announceDate)}</span><span>รหัสโครงการ {tor.id}</span></div>
                <span className={`match-badge ${tor.matchScore != null ? (tor.matchScore >= 80 ? 'match-high' : tor.matchScore >= 50 ? 'match-medium' : 'match-low') : 'match-uncertain'}`}>
                  {tor.matchScore != null ? `${tor.matchScore}% ตรงกับคุณ` : isGuest ? "เข้าสู่ระบบเพื่อจับคู่" : "รอการจับคู่"}
                </span>
              </div>
              <h2>{tor.title}</h2><p className="feed-agency"><span aria-hidden="true">⌂</span>{tor.agency}</p>
              <div className="feed-card-bottom">
                <div className="anomaly-slot">{tor.anomaly.highBudgetFlag && <p className="budget-warning"><span aria-hidden="true">!</span> งบประมาณสูงผิดปกติเมื่อเทียบกับข้อมูลที่มี</p>}</div>
                <div className="feed-budget"><span>งบประมาณ</span><strong>{tor.budget != null ? `${tor.budget.toLocaleString("th-TH")} บาท` : "ยังไม่ระบุงบประมาณ"}</strong></div>
                <footer>
                  <span className="feed-status"><i />{statusLabel(tor.projectStatus)}</span>
                  {isGuest ? (
                    <span className="feed-card-guest-hint">เข้าสู่ระบบเพื่อดูรายละเอียดฉบับเต็ม →</span>
                  ) : (
                    <span className="feed-card-view-hint">ดูรายละเอียดโครงการ →</span>
                  )}
                </footer>
                <div className="technology-tags">{tor.techStack.length ? tor.techStack.map((name, index) => <span key={`${name}-${index}`}>{name}</span>) : <span className="unknown-tag">ยังไม่มีข้อมูลเทคโนโลยี</span>}</div>
              </div>
            </Link>
          );
        })}
        {!loading && !error && visibleItems.length === 0 && <p className="feed-empty">ไม่พบโครงการที่ตรงกับตัวกรองที่เลือก</p>}
      </section>
    </div>
  </main>;
}
