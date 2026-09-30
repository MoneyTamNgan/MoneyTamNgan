"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import DocumentObservationItem from "@/components/ui/DocumentObservationItem";

const ITEMS_PER_PAGE = 5;

export default function DocumentObservationsCard({ anomalies }) {
  const [page, setPage] = useState(1);
  const [largestPageHeight, setLargestPageHeight] = useState(null);
  const cardRef = useRef(null);
  const measurementRefs = useRef([]);
  const highBudgetFlag = Boolean(anomalies?.high_budget_flag);
  const flaggedClauses = Array.isArray(anomalies?.flagged_clauses) ? anomalies.flagged_clauses : [];
  const pages = useMemo(() => Array.from(
    { length: Math.ceil(flaggedClauses.length / ITEMS_PER_PAGE) },
    (_, index) => flaggedClauses.slice(index * ITEMS_PER_PAGE, (index + 1) * ITEMS_PER_PAGE)
  ), [flaggedClauses]);
  const totalPages = Math.max(1, pages.length);
  const hasAnomaly = highBudgetFlag || flaggedClauses.length > 0;
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
  const pageStyle = largestPageHeight ? { "--anomaly-page-height": `${largestPageHeight}px` } : undefined;

  return (
    <section className="tor-anomaly-card tor-anomaly-pagination-card" ref={cardRef}>
      <p className="tor-section-kicker">ข้อมูลตรวจสอบ</p>
      <h2>ข้อสังเกตจากเอกสาร</h2>
      {hasAnomaly ? (
        <>
          {highBudgetFlag && (
            <p className="tor-anomaly-budget">
              งบประมาณมีข้อสังเกตเมื่อเทียบกับข้อมูลที่มี
              {anomalies.budget_deviation_multiplier > 0
                ? ` (${anomalies.budget_deviation_multiplier.toLocaleString("th-TH")} เท่า)`
                : ""}
            </p>
          )}
          {flaggedClauses.length ? (
            <>
              <ul className="tor-anomaly-list" style={pageStyle}>
                {visibleItems.map((clause, index) => (
                  <DocumentObservationItem
                    clauseText={clause.clause_text}
                    reason={clause.reason}
                    key={`${clause.clause_text}-${(page - 1) * ITEMS_PER_PAGE + index}`}
                  />
                ))}
              </ul>

              <div className="anomaly-page-measurements" aria-hidden="true">
                {pages.map((observationPage, pageIndex) => (
                  <ul
                    className="tor-anomaly-list anomaly-list-measurement"
                    key={`measurement-page-${pageIndex}`}
                    ref={(element) => { measurementRefs.current[pageIndex] = element; }}
                  >
                    {observationPage.map((clause, index) => (
                      <li className="tor-observation-item" key={`${clause.clause_text}-${index}`}>
                        <div className="tor-observation-toggle">
                          <strong>{clause.clause_text}</strong>
                          <span>แสดงรายละเอียด ↓</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                ))}
              </div>

              {totalPages > 1 && (
                <nav className="tor-qualification-pagination tor-anomaly-pagination" aria-label="หน้าข้อสังเกตจากเอกสาร">
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
          ) : null}
        </>
      ) : (
        <p>ยังไม่พบข้อสังเกตจากข้อมูลที่จัดเก็บ</p>
      )}
    </section>
  );
}
