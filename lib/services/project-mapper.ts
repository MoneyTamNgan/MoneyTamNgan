import type { ProjectRecord } from "@/types/project";
import type { AnomalyReport, Tor, TorStatus, TorSummary } from "@/types/tor";

const torStatuses: TorStatus[] = ["Active", "Superseded", "Invalid", "Cancelled"];

function toTorStatus(project: ProjectRecord): TorStatus {
  if (!project.version_info.is_latest) return "Superseded";
  return torStatuses.includes(project.project_status as TorStatus) ? project.project_status as TorStatus : "Active";
}

export function projectToTor(project: ProjectRecord): Tor {
  const multiplier = project.anomalies.budget_deviation_multiplier;
  const budgetAnomaly = project.anomalies.high_budget_flag && multiplier > 0
    ? { baselinePrice: project.budget / multiplier, deviationMultiplier: multiplier, tag: "HIGH_BUDGET_ANOMALY" as const }
    : null;
  const fallbackDate = project.timeline.announce_date ?? "ยังไม่มีข้อมูล";
  return { id: project.project_id, title: project.project_name, agency: project.dept_name, budget: project.budget, releaseDate: fallbackDate, sourceUrl: project.pdf_url ?? "ยังไม่มีข้อมูล", pdfUrl: project.pdf_url ?? null, status: toTorStatus(project), isSoftware: project.is_software, classificationConfidence: null, supersededByTorId: project.version_info.superseded_by, matchScore: null, budgetAnomaly, createdAt: project.created_at ?? fallbackDate, updatedAt: project.updated_at ?? fallbackDate };
}

export function projectToTorSummary(project: ProjectRecord): TorSummary {
  return { torId: project.project_id, executiveSummary: project.extracted_data.summary ?? "ยังไม่มีข้อมูล", vendorEligibility: project.extracted_data.qualifications.length ? project.extracted_data.qualifications.join("\n") : "ยังไม่มีข้อมูล", requiredTeamExperience: "ยังไม่มีข้อมูล", requiredTechStack: project.extracted_data.tech_stack, requiredCertifications: [], generatedAt: project.updated_at ?? project.timeline.announce_date ?? null };
}

export function projectToAnomalyReport(project: ProjectRecord): AnomalyReport {
  const tor = projectToTor(project);
  return { torId: project.project_id, budgetAnomaly: tor.budgetAnomaly, flaggedClauses: project.anomalies.flagged_clauses.map((clause) => ({ clauseText: clause.clause_text, type: "OTHER", reasoning: clause.reason })) };
}
