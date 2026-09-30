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

    it("the error envelope shape ({error:{code,message}}) satisfies the Error schema", () => {
        const validate = validatorFor("Error");
        expectValid(validate, { error: { code: "TOR_NOT_FOUND", message: "No TOR exists with id: x" } });
    });
});
