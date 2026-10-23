"use client";

import { useLayoutEffect, useRef, useState } from "react";

export default function ProjectSummaryCard({ summary }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const summaryRef = useRef(null);
  const content = summary || "ยังไม่มีข้อมูลสรุปจากเอกสาร";

  useLayoutEffect(() => {
    const measure = () => {
      if (!summaryRef.current || isExpanded) return;
      setCanExpand(summaryRef.current.scrollHeight > summaryRef.current.clientHeight + 1);
    };

    measure();
    const observer = new ResizeObserver(measure);
    if (summaryRef.current) observer.observe(summaryRef.current);
    return () => observer.disconnect();
  }, [content, isExpanded]);

  return (
    <section className="tor-project-summary">
      <article className="tor-summary-card">
        <p className="tor-section-kicker">สรุปจากเอกสาร</p>
        <h2>ภาพรวมโครงการ</h2>
        <p ref={summaryRef} className={isExpanded ? "tor-summary-content is-expanded" : "tor-summary-content"}>{content}</p>
        {canExpand && (
          <button type="button" className="tor-summary-toggle" onClick={() => setIsExpanded((expanded) => !expanded)} aria-expanded={isExpanded}>
            {isExpanded ? "ย่อรายละเอียด ↑" : "อ่านเพิ่มเติม ↓"}
          </button>
        )}
      </article>
    </section>
  );
}
