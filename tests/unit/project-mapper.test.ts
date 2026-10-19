import { describe, expect, it } from "vitest";
import { mockProjectRecords } from "@/lib/mock-project-records";
import { projectToAnomalyReport, projectToTor, projectToTorSummary } from "@/lib/services/project-mapper";

const fullProject = mockProjectRecords.find((p) => p.project_id === "DGA-2563-07-10")!;
const sparseProject = mockProjectRecords.find((p) => p.project_id === "TOR-2569-003")!;
const supersededProject = mockProjectRecords.find((p) => p.project_id === "TOR-2569-007")!;
const highBudgetProject = mockProjectRecords.find((p) => p.project_id === "TOR-2569-002")!;

describe("projectToTor", () => {
    it("maps a fully-populated project, including pdfUrl and budget anomaly", () => {
        const tor = projectToTor(fullProject);
        expect(tor.id).toBe("DGA-2563-07-10");
        expect(tor.pdfUrl).toBe(fullProject.pdf_url);
        expect(tor.sourceUrl).toBe(fullProject.pdf_url);
        expect(tor.status).toBe("Active");
        expect(tor.budgetAnomaly).toBeNull();
    });

    it("falls back to a placeholder string when releaseDate/sourceUrl are missing", () => {
        const tor = projectToTor(sparseProject);
        expect(tor.pdfUrl).toBeNull();
        expect(tor.sourceUrl).toBe("ยังไม่มีข้อมูล");
    });

    it("reports status Superseded for a non-latest version regardless of project_status", () => {
        const tor = projectToTor(supersededProject);
        expect(tor.status).toBe("Superseded");
        expect(tor.supersededByTorId).toBe("TOR-2569-014");
    });

    it("surfaces a HIGH_BUDGET_ANOMALY tag with a baseline price", () => {
        const tor = projectToTor(highBudgetProject);
        expect(tor.budgetAnomaly).toEqual({
            baselinePrice: highBudgetProject.budget / 1.76,
            deviationMultiplier: 1.76,
            tag: "HIGH_BUDGET_ANOMALY",
        });
    });
});

describe("projectToTorSummary", () => {
    it("joins qualifications into vendorEligibility when present", () => {
        const summary = projectToTorSummary(fullProject);
        expect(summary.torId).toBe("DGA-2563-07-10");
        expect(summary.vendorEligibility).toBe(fullProject.extracted_data.qualifications.join("\n"));
        expect(summary.requiredTechStack).toEqual(fullProject.extracted_data.tech_stack);
    });

    it("falls back to a placeholder when there is no summary/qualifications", () => {
        const summary = projectToTorSummary(sparseProject);
        expect(summary.executiveSummary).toBe("ยังไม่มีข้อมูล");
        expect(summary.vendorEligibility).toBe("ยังไม่มีข้อมูล");
    });
});

describe("projectToAnomalyReport", () => {
    it("maps flagged clauses with type OTHER and reuses the budget anomaly from projectToTor", () => {
        const report = projectToAnomalyReport(fullProject);
        expect(report.torId).toBe("DGA-2563-07-10");
        expect(report.budgetAnomaly).toBeNull();
        expect(report.flaggedClauses).toHaveLength(fullProject.anomalies.flagged_clauses.length);
        expect(report.flaggedClauses[0]).toEqual({
            clauseText: fullProject.anomalies.flagged_clauses[0].clause_text,
            type: "OTHER",
            reasoning: fullProject.anomalies.flagged_clauses[0].reason,
        });
    });

    it("returns an empty flaggedClauses array when there are none", () => {
        const report = projectToAnomalyReport(sparseProject);
        expect(report.flaggedClauses).toEqual([]);
    });
});
