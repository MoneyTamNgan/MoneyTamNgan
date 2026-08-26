import type { AnomalyReport, Tor, TorSummary } from "@/types/tor";

export const mockTors: Tor[] = [
  { id: "TOR-2569-001", title: "โครงการพัฒนาระบบบริการประชาชนดิจิทัล", agency: "สำนักดิจิทัลกรุงเทพมหานคร", budget: 7_479_600, releaseDate: "2026-08-01", sourceUrl: "https://example.invalid/tors/TOR-2569-001", pdfUrl: null, status: "Active", isSoftware: true, classificationConfidence: 0.96, supersededByTorId: null, matchScore: 82, budgetAnomaly: null, createdAt: "2026-08-01T08:00:00.000Z", updatedAt: "2026-08-01T08:00:00.000Z" },
  { id: "TOR-2569-002", title: "ระบบบริหารจัดการจราจรอัจฉริยะ", agency: "สำนักการจราจรและขนส่ง", budget: 15_000_000, releaseDate: "2026-08-12", sourceUrl: "https://example.invalid/tors/TOR-2569-002", pdfUrl: null, status: "Active", isSoftware: true, classificationConfidence: 0.91, supersededByTorId: null, matchScore: 74, budgetAnomaly: { baselinePrice: 8_500_000, deviationMultiplier: 1.76, tag: "HIGH_BUDGET_ANOMALY" }, createdAt: "2026-08-12T08:00:00.000Z", updatedAt: "2026-08-12T08:00:00.000Z" },
  { id: "TOR-2569-003", title: "จัดซื้อครุภัณฑ์สำนักงาน", agency: "สำนักการคลัง", budget: 950_000, releaseDate: "2026-08-20", sourceUrl: "https://example.invalid/tors/TOR-2569-003", pdfUrl: null, status: "Active", isSoftware: false, classificationConfidence: 0.98, supersededByTorId: null, matchScore: null, budgetAnomaly: null, createdAt: "2026-08-20T08:00:00.000Z", updatedAt: "2026-08-20T08:00:00.000Z" },
];

export const mockTorSummaries: Record<string, TorSummary> = {
  "TOR-2569-001": { torId: "TOR-2569-001", executiveSummary: "พัฒนาระบบบริการดิจิทัลเพื่อให้ประชาชนเข้าถึงข้อมูลและบริการของกรุงเทพมหานครได้สะดวกขึ้น", vendorEligibility: "มีประสบการณ์พัฒนาระบบสารสนเทศและมีทีมงานด้านความมั่นคงปลอดภัย", requiredTeamExperience: "ยังไม่มีข้อมูล", requiredTechStack: ["React", "Node.js", "Cloud"], requiredCertifications: [], generatedAt: "2026-08-02T08:00:00.000Z" },
  "TOR-2569-002": { torId: "TOR-2569-002", executiveSummary: "พัฒนาระบบติดตามและวิเคราะห์ข้อมูลจราจรเพื่อสนับสนุนการตัดสินใจของเจ้าหน้าที่", vendorEligibility: "มีผลงานระบบข้อมูลขนาดใหญ่", requiredTeamExperience: "ยังไม่มีข้อมูล", requiredTechStack: ["Data Analytics", "API", "Cloud"], requiredCertifications: [], generatedAt: "2026-08-13T08:00:00.000Z" },
};

export const mockAnomalyReports: Record<string, AnomalyReport> = {
  "TOR-2569-001": { torId: "TOR-2569-001", budgetAnomaly: null, flaggedClauses: [] },
  "TOR-2569-002": { torId: "TOR-2569-002", budgetAnomaly: { baselinePrice: 8_500_000, deviationMultiplier: 1.76, tag: "HIGH_BUDGET_ANOMALY" }, flaggedClauses: [] },
};
