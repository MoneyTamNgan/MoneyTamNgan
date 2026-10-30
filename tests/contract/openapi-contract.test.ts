import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { load as loadYaml } from "js-yaml";
import { mockProjectRecords } from "@/lib/mock-project-records";
import {
    toTorAnomalyReport,
    toTorDetail,
    toTorListItem,
    toTorSummary,
} from "@/lib/api/tor-response";
import { toExportRow, toSpendAggregates } from "@/lib/analytics";
import { toLowConfidenceReviewItem } from "@/lib/low-confidence-review";
import { evaluateBudgetAnomaly } from "@/lib/budget-anomaly";

/**
 * OpenAPI 3.0's `nullable: true` is not a JSON Schema keyword Ajv understands.
 * Recursively rewrite it into `type: [<orig>, "null"]` so plain Ajv can validate
 * against the schemas defined in docs/api/openapi.yaml without extra tooling.
 */
function toJsonSchema(node: unknown): any {
    if (Array.isArray(node)) return node.map(toJsonSchema);
    if (node === null || typeof node !== "object") return node;

    const converted: any = {};
    for (const [key, value] of Object.entries(node)) {
        converted[key] = toJsonSchema(value);
    }

    if (converted.nullable === true && converted.type) {
        converted.type = Array.isArray(converted.type)
            ? [...converted.type, "null"]
            : [converted.type, "null"];
        // An `enum` is checked independently of `type` in JSON Schema, so a
        // nullable field also needs `null` added to its enum list (if any).
        if (Array.isArray(converted.enum) && !converted.enum.includes(null)) {
            converted.enum = [...converted.enum, null];
        }
        delete converted.nullable;
    }

    return converted;
}

const specPath = path.resolve(__dirname, "../../docs/api/openapi.yaml");
const spec = loadYaml(fs.readFileSync(specPath, "utf8"));

const ajv = new Ajv({ strict: false });
addFormats(ajv);
// Index the whole (converted) spec under one id so "#/components/schemas/X"
// $refs resolve against it, without validating the spec's non-schema keys.
ajv.addSchema(toJsonSchema(spec), "spec");

function validatorFor(schemaName) {
    return ajv.compile({ $ref: `spec#/components/schemas/${schemaName}` });
}

function expectValid(validate, payload) {
    const valid = validate(payload);
    if (!valid) {
        throw new Error(`Schema mismatch: ${ajv.errorsText(validate.errors, { dataVar: "payload" })}`);
    }
    expect(valid).toBe(true);
}

const fullProject = mockProjectRecords.find((p) => p.project_id === "DGA-2563-07-10");
const sparseProject = mockProjectRecords.find((p) => p.project_id === "TOR-2569-003");

describe("TOR API responses match docs/api/openapi.yaml", () => {
    it("includes baseline evidence and the budget anomaly tag without changing legacy field names", () => {
        const project = { ...fullProject, budget: 160, anomalies: {
            ...fullProject.anomalies,
            ...evaluateBudgetAnomaly({ ...fullProject, budget: 160 }, [90, 100, 110].map((budget, i) => ({ project_id: `peer-${i}`, budget }))),
        } };
        expectValid(validatorFor("TorListItem"), toTorListItem(project));
        expectValid(validatorFor("TorDetail"), toTorDetail(project));
        expectValid(validatorFor("TorApiAnomalyReport"), toTorAnomalyReport(project));
        expect(toTorDetail(project).anomalies[0]).toMatchObject({ tag: "HIGH_BUDGET_ANOMALY", baselinePrice: 100, budgetDeviationMultiplier: 1.6 });
        const fallback = { ...project, anomalies: evaluateBudgetAnomaly(project, []) };
        expectValid(validatorFor("TorApiAnomalyReport"), toTorAnomalyReport(fallback));
        expect(toTorAnomalyReport(fallback)).toMatchObject({ baselinePrice: 160, baselineSampleCount: 0, budgetDeviationMultiplier: 1, tags: [] });
    });
    it("low-confidence review returns its documented compact admin contract", () => {
        const item = toLowConfidenceReviewItem({ project_id: "fixture", project_name: "ชื่อโครงการ",
            dept_name: "หน่วยงาน", is_software: true, classification: { status: "software" },
            __classificationConfidence: 0.65, __extractionConfidence: null, __confidenceScore: 0.65 });
        expectValid(validatorFor("LowConfidenceReviewPage"), { items: [item], total: 1,
            page: 1, pageSize: 20, totalPages: 1, threshold: 0.7, confidenceType: "either" });
    });
    it("preserves the fiscal response shape for unavailable document coverage", () => {
        const validate = validatorFor("TorDetail");
        const payload = toTorDetail(fullProject);
        payload.fiscalBudget = { year: null, years: [], status: "document_unavailable",
            method: "none", source: "combined", evidence: [], warnings: ["incomplete_document_coverage"] };
        expectValid(validate, payload);
    });
    it("toTorListItem satisfies TorListItem for a full and a sparse project", () => {
        const validate = validatorFor("TorListItem");
        expectValid(validate, toTorListItem(fullProject));
        expectValid(validate, toTorListItem(sparseProject));
    });

    it("toTorDetail satisfies TorDetail for a full and a sparse project", () => {
        const validate = validatorFor("TorDetail");
        expectValid(validate, toTorDetail(fullProject));
        expectValid(validate, toTorDetail(sparseProject));
    });

    it("toTorSummary satisfies TorApiSummary", () => {
        const validate = validatorFor("TorApiSummary");
        expectValid(validate, toTorSummary(fullProject));
        expectValid(validate, toTorSummary(sparseProject));
    });

    it("toTorAnomalyReport satisfies TorApiAnomalyReport", () => {
        const validate = validatorFor("TorApiAnomalyReport");
        expectValid(validate, toTorAnomalyReport(fullProject));
        expectValid(validate, toTorAnomalyReport(sparseProject));
    });

    it("analytics aggregates satisfy AnalyticsAggregates, including an empty result", () => {
        const validate = validatorFor("AnalyticsAggregates");
        expectValid(validate, toSpendAggregates(undefined));
        expectValid(validate, toSpendAggregates({
            totals: [{ projectCount: 2, totalSpend: 3, meanBudget: 1.5, medianDuration: 90,
                softwareCount: 1, highBudgetCount: 0, summarizedCount: 1 }],
            byAgency: [{ _id: null, projectCount: 2, totalSpend: 3, meanBudget: 1.5 }],
            byStatus: [{ _id: "Active", projectCount: 2 }],
            technologies: [{ _id: "React", projectCount: 1 }],
            flaggedOnly: [],
        }));
    });

    it("toExportRow satisfies AnalyticsExportRow for a full and a sparse project", () => {
        const validate = validatorFor("AnalyticsExportRow");
        expectValid(validate, toExportRow(fullProject));
        expectValid(validate, toExportRow(sparseProject));
    });

    it("the error envelope shape ({error:{code,message}}) satisfies the Error schema", () => {
        const validate = validatorFor("Error");
        expectValid(validate, { error: { code: "TOR_NOT_FOUND", message: "No TOR exists with id: x" } });
    });
});
