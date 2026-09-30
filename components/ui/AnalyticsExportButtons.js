"use client";

import { useState } from "react";

function downloadFile(content, filename, type) {
  const file = new Blob([content], { type });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll("\"", "\"\"")}"`;
}

function projectToCsvRow(project) {
  return [project.project_id, project.project_name, project.dept_name, project.dept_sub_name, project.budget, project.project_status, project.is_software, project.timeline.announce_date, project.timeline.contract_start, project.timeline.contract_end, project.timeline.duration_days, project.pdf_url, project.extracted_data.summary, project.extracted_data.qualifications.join(" | "), project.extracted_data.scope_of_work.join(" | "), project.extracted_data.tech_stack.join(" | "), project.anomalies.high_budget_flag, project.anomalies.budget_deviation_multiplier, project.anomalies.flagged_clauses.map((clause) => `${clause.clause_text} — ${clause.reason}`).join(" | "), project.version_info.version, project.version_info.is_latest, project.version_info.superseded_by, project.created_at, project.updated_at].map(csvCell).join(",");
}

export default function AnalyticsExportButtons({ projects }) {
  const [message, setMessage] = useState("");

  function exportJson() {
    downloadFile(JSON.stringify(projects, null, 2), "tor-projects.json", "application/json;charset=utf-8");
    setMessage("ดาวน์โหลดไฟล์ JSON แล้ว");
  }

  function exportCsv() {
    const headers = ["project_id", "project_name", "dept_name", "dept_sub_name", "budget", "project_status", "is_software", "announce_date", "contract_start", "contract_end", "duration_days", "pdf_url", "summary", "qualifications", "scope_of_work", "tech_stack", "high_budget_flag", "budget_deviation_multiplier", "flagged_clauses", "version", "is_latest", "superseded_by", "created_at", "updated_at"];
    downloadFile(`\uFEFF${headers.join(",")}\n${projects.map(projectToCsvRow).join("\n")}`, "tor-projects.csv", "text/csv;charset=utf-8");
    setMessage("ดาวน์โหลดไฟล์ CSV แล้ว");
  }

  return <div className="analytics-export"><span>ส่งออกข้อมูล</span><button type="button" onClick={exportJson}>JSON</button><button type="button" onClick={exportCsv}>CSV</button><p role="status">{message}</p></div>;
}
