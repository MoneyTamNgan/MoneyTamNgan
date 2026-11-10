"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

const ITEMS_PER_PAGE = 5;

function QualificationItem({ item }) {
  const [expanded, setExpanded] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const textId = useId();
  const textRef = useRef(null);

  useLayoutEffect(() => {
    if (expanded) return;

    const text = textRef.current;
    const measureOverflow = () => setHasMore(text.scrollHeight > text.clientHeight);
    measureOverflow();
    const observer = new ResizeObserver(measureOverflow);
    observer.observe(text);
    return () => observer.disconnect();
  }, [item, expanded]);

  return (
    <li>
      <p id={textId} ref={textRef} className={expanded ? undefined : "qualification-text-collapsed"}>
        {item}
      </p>
      {(hasMore || expanded) && (
        <button
          type="button"
          className="qualification-text-toggle"
          aria-controls={textId}
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "ย่อข้อความ" : "… ดูเพิ่มเติม"}
        </button>
      )}
    </li>
  );
}

export default function BidderQualificationCard({ items, hasDocument }) {
  const [page, setPage] = useState(1);
  const [largestPageHeight, setLargestPageHeight] = useState(null);
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
      const largest = Math.max(0, ...measurementRefs.current.slice(0, pages.length).map((element) => element?.offsetHeight ?? 0));
      const nextHeight = largest ? Math.ceil(largest) : null;
      setLargestPageHeight((currentHeight) => currentHeight === nextHeight ? currentHeight : nextHeight);
    };

    measurePages();
    const observer = new ResizeObserver(measurePages);
    for (const list of measurementRefs.current.slice(0, pages.length)) {
      if (list) observer.observe(list);
    }
    return () => observer.disconnect();
  }, [pages]);

  const pageStyle = largestPageHeight ? { "--qualification-page-height": `${largestPageHeight}px` } : undefined;

  return (
    <article className="tor-detail-card tor-qualification-card">
      <p className="tor-section-kicker">ข้อกำหนดจากเอกสาร</p>
      <h2>คุณสมบัติผู้ยื่นข้อเสนอ</h2>

      {items.length ? (
        <>
          <ul className="qualification-list" style={pageStyle}>
            {visibleItems.map((item, index) => (
              <QualificationItem key={`${item}-${(page - 1) * ITEMS_PER_PAGE + index}`} item={item} />
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
                  <QualificationItem key={`${item}-${index}`} item={item} />
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
