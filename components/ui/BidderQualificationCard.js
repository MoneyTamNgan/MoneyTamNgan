"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

const ITEMS_PER_PAGE = 5;

export default function BidderQualificationCard({ items, hasDocument }) {
  const [page, setPage] = useState(1);
  const [largestPageHeight, setLargestPageHeight] = useState(null);
  const cardRef = useRef(null);
  const measurementRefs = useRef([]);
  const pages = useMemo(() => Array.from(
    { length: Math.ceil(items.length / ITEMS_PER_PAGE) },
    (_, index) => items.slice(index * ITEMS_PER_PAGE, (index + 1) * ITEMS_PER_PAGE)
  ), [items]);
  const totalPages = Math.max(1, pages.length);

  useEffect(() => {
    setPage((currentPage) => Math.min(currentPage, totalPages));
  }, [totalPages]);

  const visibleItems = pages[page - 1] ?? [];

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
  const pageStyle = largestPageHeight ? { "--qualification-page-height": `${largestPageHeight}px` } : undefined;

  return (
    <article className="tor-detail-card tor-qualification-card" ref={cardRef}>
      <p className="tor-section-kicker">ข้อกำหนดจากเอกสาร</p>
      <h2>คุณสมบัติผู้ยื่นข้อเสนอ</h2>

      {items.length ? (
        <>
          <ul className="qualification-list" style={pageStyle}>
            {visibleItems.map((item, index) => (
              <li key={`${item}-${(page - 1) * ITEMS_PER_PAGE + index}`}>
                <p>{item}</p>
              </li>
            ))}
          </ul>

          <div className="qualification-page-measurements" aria-hidden="true">
            {pages.map((qualificationPage, pageIndex) => (
              <ul
                className="qualification-list qualification-list-measurement"
                key={`measurement-page-${pageIndex}`}
                ref={(element) => { measurementRefs.current[pageIndex] = element; }}
              >
                {qualificationPage.map((item, index) => (
                  <li key={`${item}-${index}`}>
                    <p>{item}</p>
                  </li>
                ))}
              </ul>
            ))}
          </div>

          {totalPages > 1 && (
            <nav className="tor-qualification-pagination" aria-label="หน้าคุณสมบัติผู้ยื่นข้อเสนอ">
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
      ) : (
        <div className="tor-pending-state">
          <strong>{hasDocument ? "รอประมวลผลเอกสาร" : "ยังไม่มีเอกสาร TOR"}</strong>
          <p>ยังไม่มีข้อมูลคุณสมบัติที่สกัดจากเอกสาร จึงไม่สามารถเปรียบเทียบกับโปรไฟล์บริษัทได้</p>
        </div>
      )}
    </article>
  );
}
