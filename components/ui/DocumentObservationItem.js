"use client";

import { useId, useState } from "react";

export default function DocumentObservationItem({ clauseText, reason }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const detailsId = useId();

  return (
    <li className={`tor-observation-item ${isExpanded ? "is-expanded" : "is-collapsed"}`}>
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
      {isExpanded && <p id={detailsId}>{reason}</p>}
    </li>
  );
}
