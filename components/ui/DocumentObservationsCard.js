"use client";

import { useEffect, useMemo, useState } from "react";
import DocumentObservationItem from "@/components/ui/DocumentObservationItem";

const ITEMS_PER_PAGE = 4;

export default function DocumentObservationsCard({ anomalies }) {
  const [page, setPage] = useState(1);
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

  return (
    <section className="tor-anomaly-card tor-anomaly-pagination-card">
      <p className="tor-section-kicker">วิเคราะห์โดย Vertex AI Gemini Flash</p>
      <h2>ข้อกำหนดที่ควรตรวจสอบ</h2>
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
              <ul className="tor-anomaly-list">
                {visibleItems.map((clause, index) => (
                  <DocumentObservationItem
                    clauseText={clause.clause_text}
                    reason={clause.reason}
                    explanation={clause.explanation}
                    highlightReason={clause.highlight_reason}
                    category={clause.category}
                    severity={clause.severity}
                    page={clause.page}
                    confidence={clause.confidence}
                    key={`${clause.clause_text}-${(page - 1) * ITEMS_PER_PAGE + index}`}
                  />
                ))}
              </ul>

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
