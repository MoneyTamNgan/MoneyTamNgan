"use client";

import { useId, useState } from "react";

const categoryLabels = {
  unrealistic_tenure: "ระยะเวลาหรือประสบการณ์สูงผิดปกติ",
  excessive_hardware: "ความต้องการ Hardware สูงผิดปกติ",
  vendor_lock_in: "ความเสี่ยง Vendor Lock-in",
};

const severityLabels = {
  low: "ความเสี่ยงต่ำ",
  medium: "ความเสี่ยงปานกลาง",
  high: "ความเสี่ยงสูง",
};

export default function DocumentObservationItem({
  clauseText,
  reason,
  explanation,
  highlightReason,
  category,
  severity,
  page,
  confidence,
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const detailsId = useId();

  return (
    <li className={`tor-observation-item tor-risk-finding severity-${severity || "unknown"} ${isExpanded ? "is-expanded" : "is-collapsed"}`}>
      <div className="tor-risk-badges">
        <span>{categoryLabels[category] || "ข้อสังเกตอื่น"}</span>
        {severity && <span>{severityLabels[severity] || severity}</span>}
        {page && <span>หน้า {page.toLocaleString("th-TH")}</span>}
      </div>
      <button
        type="button"
        className="tor-observation-toggle"
        onClick={() => setIsExpanded((expanded) => !expanded)}
        aria-expanded={isExpanded}
        aria-controls={detailsId}
      >
        <strong>{clauseText}</strong>
        <span>{isExpanded ? "ซ่อนรายละเอียด ↑" : "แสดงรายละเอียด ↓"}</span>
      </button>
      {isExpanded && (
        <div id={detailsId}>
          {highlightReason && <p className="tor-highlight-reason"><b>เหตุผลที่ไฮไลต์</b>{highlightReason}</p>}
          <p className="tor-risk-explanation">{explanation || reason}</p>
          {typeof confidence === "number" && <small>ความเชื่อมั่น {(confidence * 100).toLocaleString("th-TH", { maximumFractionDigits: 0 })}%</small>}
        </div>
      )}
    </li>
  );
}
