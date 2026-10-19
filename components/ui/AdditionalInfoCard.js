"use client";

import { useEffect, useMemo, useState } from "react";

const ITEMS_PER_PAGE = 5;

export default function AdditionalInfoCard({ scopeItems }) {
  const [page, setPage] = useState(1);
  const pages = useMemo(() => Array.from(
    { length: Math.ceil(scopeItems.length / ITEMS_PER_PAGE) },
    (_, index) => scopeItems.slice(index * ITEMS_PER_PAGE, (index + 1) * ITEMS_PER_PAGE)
  ), [scopeItems]);
  const totalPages = Math.max(1, pages.length);
  const visibleItems = pages[page - 1] ?? [];

  useEffect(() => {
    setPage((currentPage) => Math.min(currentPage, totalPages));
  }, [totalPages]);

  return (
    <article className="tor-summary-card tor-technical-summary-card tor-additional-info-card">
      <p className="tor-section-kicker">รายละเอียดที่สกัดได้</p>
      <h2>ข้อมูลเพิ่มเติม</h2>
      {scopeItems.length ? (
        <>
          <ul className="additional-info-list">
            {visibleItems.map((item, index) => <li key={`${item}-${(page - 1) * ITEMS_PER_PAGE + index}`}>{item}</li>)}
          </ul>

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
