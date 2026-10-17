"use client";

"use client";

import { useState } from "react";

function exportUrl(format, query) {
  const params = new URLSearchParams({ format });
  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  });
  return `/api/analytics/overview/export?${params.toString()}`;
}

export default function AnalyticsExportButtons({ query }) {
  const [message, setMessage] = useState("");

  function download(format) {
    window.location.assign(exportUrl(format, query));
    setMessage(`กำลังเตรียมไฟล์ ${format.toUpperCase()}`);
  }

  return <div className="analytics-export"><span>ส่งออกข้อมูล</span><button type="button" onClick={() => download("json")}>JSON</button><button type="button" onClick={() => download("csv")}>CSV</button><p role="status">{message}</p></div>;
}
