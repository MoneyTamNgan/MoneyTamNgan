"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

const ITEMS_PER_PAGE = 5;

export default function AdditionalInfoCard({ scopeItems }) {
  const [page, setPage] = useState(1);
  const [largestPageHeight, setLargestPageHeight] = useState(null);
  const cardRef = useRef(null);
  const measurementRefs = useRef([]);
  const pages = useMemo(() => Array.from(
    { length: Math.ceil(scopeItems.length / ITEMS_PER_PAGE) },
    (_, index) => scopeItems.slice(index * ITEMS_PER_PAGE, (index + 1) * ITEMS_PER_PAGE)
  ), [scopeItems]);
  const totalPages = Math.max(1, pages.length);
  const visibleItems = pages[page - 1] ?? [];

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
  const pageStyle = largestPageHeight ? { "--additional-info-page-height": `${largestPageHeight}px` } : undefined;

  return (
    <article className="tor-summary-card tor-technical-summary-card tor-additional-info-card" ref={cardRef}>
      <p className="tor-section-kicker">รายละเอียดที่สกัดได้</p>
      <h2>ข้อมูลเพิ่มเติม</h2>
      {scopeItems.length ? (
        <>
          <ul className="additional-info-list" style={pageStyle}>
            {visibleItems.map((item, index) => <li key={`${item}-${(page - 1) * ITEMS_PER_PAGE + index}`}>{item}</li>)}
          </ul>

          <div className="additional-info-page-measurements" aria-hidden="true">
            {pages.map((scopePage, pageIndex) => (
              <ul
                className="additional-info-list additional-info-list-measurement"
                key={`measurement-page-${pageIndex}`}
                ref={(element) => { measurementRefs.current[pageIndex] = element; }}
              >
                {scopePage.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
              </ul>
            ))}
          </div>

          {totalPages > 1 && (
            <nav className="tor-qualification-pagination tor-additional-info-pagination" aria-label="หน้าข้อมูลเพิ่มเติม">
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
      ) : <p>ยังไม่มีข้อมูลขอบเขตงาน</p>}

    </article>
  );
}
