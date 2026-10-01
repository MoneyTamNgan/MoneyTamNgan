"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getContractorProfile } from "@/lib/services/contractor-profile-service";

const ITEMS_PER_PAGE = 5;
const emptyProfile = { company_name: "", skills: [] };

function normalizeTech(value) {
  return String(value).toLocaleLowerCase().replace(/[^a-z0-9ก-๙]/g, "");
}

export default function TechStackComparisonCard({ items }) {
  const [page, setPage] = useState(1);
  const [profile, setProfile] = useState(emptyProfile);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [largestPageHeight, setLargestPageHeight] = useState(null);
  const cardRef = useRef(null);
  const measurementRefs = useRef([]);
  const requiredTech = useMemo(
    () => items.filter((item, index) => items.findIndex((candidate) => normalizeTech(candidate) === normalizeTech(item)) === index),
    [items]
  );
  const pages = useMemo(() => Array.from(
    { length: Math.ceil(requiredTech.length / ITEMS_PER_PAGE) },
    (_, index) => requiredTech.slice(index * ITEMS_PER_PAGE, (index + 1) * ITEMS_PER_PAGE)
  ), [requiredTech]);
  const totalPages = Math.max(1, pages.length);
  const visibleItems = pages[page - 1] ?? [];
  const companyTech = useMemo(
    () => new Set(profile.skills.map(normalizeTech).filter(Boolean)),
    [profile.skills]
  );
  const matchedCount = requiredTech.filter((item) => companyTech.has(normalizeTech(item))).length;
  const matchPercentage = requiredTech.length ? Math.round((matchedCount / requiredTech.length) * 100) : 0;

  useEffect(() => {
    let isCurrent = true;
    getContractorProfile()
      .then(({ profile: loadedProfile }) => {
        if (isCurrent) setProfile(loadedProfile);
      })
      .finally(() => {
        if (isCurrent) setIsLoadingProfile(false);
      });
    return () => { isCurrent = false; };
  }, []);

  useEffect(() => {
    setPage((currentPage) => Math.min(currentPage, totalPages));
  }, [totalPages]);

  useLayoutEffect(() => {
    const measurePages = () => {
      const largest = Math.max(0, ...measurementRefs.current.map((element) => element?.offsetHeight ?? 0));
      const nextHeight = largest ? Math.ceil(largest) : null;
      setLargestPageHeight((currentHeight) => currentHeight === nextHeight ? currentHeight : nextHeight);
    };

    measurePages();
    const observer = new ResizeObserver(measurePages);
    if (cardRef.current) observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, [pages]);

  measurementRefs.current = [];
  const pageStyle = largestPageHeight ? { "--tech-stack-page-height": `${largestPageHeight}px` } : undefined;
  const companyName = profile.company_name || "บริษัทของคุณ";
  const comparisonLabel = isLoadingProfile
    ? "กำลังเปรียบเทียบกับโปรไฟล์บริษัท"
    : profile.skills.length
      ? `เปรียบเทียบกับ Tech Stack ของ ${companyName}`
      : "เพิ่ม Tech Stack ในโปรไฟล์บริษัทเพื่อเริ่มเปรียบเทียบ";

  return (
    <section className="tor-tech-stack-comparison" ref={cardRef}>
      <div className="tor-tech-comparison-heading">
        <div>
          <p className="tor-section-kicker">เปรียบเทียบเทคโนโลยี</p>
          <h2>Tech Stacks ที่ต้องใช้</h2>
        </div>
        <div className="tor-tech-match-summary" aria-live="polite">
          <strong>{isLoadingProfile ? "…" : `${matchPercentage}%`}</strong>
          <span>Skill match</span>
          <small>{isLoadingProfile ? "กำลังตรวจสอบ" : `${matchedCount}/${requiredTech.length} Tech Stacks`}</small>
        </div>
      </div>
      <p className="tor-tech-comparison-note">{comparisonLabel}</p>

      {requiredTech.length ? (
        <>
          <ul className="tech-comparison-list" style={pageStyle}>
            {visibleItems.map((item, index) => {
              const isMatch = companyTech.has(normalizeTech(item));
              return (
                <li key={`${item}-${(page - 1) * ITEMS_PER_PAGE + index}`}>
                  <p>{item}</p>
                  <span className={isLoadingProfile ? "is-pending" : isMatch ? "is-match" : "is-missing"}>
                    {isLoadingProfile ? "กำลังตรวจสอบโปรไฟล์บริษัท" : isMatch ? `มีใน Tech Stack ของ ${companyName}` : "ยังไม่พบใน Tech Stack บริษัท"}
                  </span>
                </li>
              );
            })}
          </ul>

          <div className="tech-stack-page-measurements" aria-hidden="true">
            {pages.map((techPage, pageIndex) => (
              <ul
                className="tech-comparison-list tech-comparison-list-measurement"
                key={`measurement-page-${pageIndex}`}
                ref={(element) => { measurementRefs.current[pageIndex] = element; }}
              >
                {techPage.map((item, index) => (
                  <li key={`${item}-${index}`}>
                    <p>{item}</p>
                    <span>ยังไม่พบใน Tech Stack บริษัท</span>
                  </li>
                ))}
              </ul>
            ))}
          </div>

          {totalPages > 1 && (
            <nav className="tor-qualification-pagination tor-tech-stack-pagination" aria-label="หน้า Tech Stacks ที่ต้องใช้">
              <button type="button" onClick={() => setPage((currentPage) => currentPage - 1)} disabled={page === 1}>
                ← ก่อนหน้า
              </button>
              <p aria-live="polite">หน้า {page} / {totalPages}</p>
              <button type="button" onClick={() => setPage((currentPage) => currentPage + 1)} disabled={page === totalPages}>
                ถัดไป →
              </button>
            </nav>
          )}
        </>
      ) : <p className="tor-tech-comparison-empty">ยังไม่มีข้อมูลเทคโนโลยีจากเอกสาร</p>}
    </section>
  );
}
