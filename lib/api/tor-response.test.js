import { describe, expect, it } from 'vitest';
import { mockProjectRecords } from '@/lib/mock-project-records';
import {
    toTorAnomalyReport,
    toTorDetail,
    toTorListItem,
    toTorSummary,
} from '@/lib/api/tor-response';

// A "full" fixture: the richest record in the mock set (has pdf_url, evidence-shaped
// extracted_data, flagged clauses, high budget flag).
const fullProject = mockProjectRecords.find((p) => p.project_id === 'DGA-2563-07-10');

// A "sparse" fixture: minimal record with most optional sub-fields absent/undefined.
const sparseProject = mockProjectRecords.find((p) => p.project_id === 'TOR-2569-003');

describe('toTorListItem', () => {
    it('maps every required field for a fully-populated project', () => {
        const item = toTorListItem(fullProject);
        expect(item).toMatchObject({
            id: 'DGA-2563-07-10',
            title: fullProject.project_name,
            agency: fullProject.dept_name,
            budget: fullProject.budget,
            projectStatus: 'Active',
            isSoftware: true,
        });
        expect(item.announceDate).toBe(new Date(fullProject.timeline.announce_date).toISOString());
        expect(item.classification).toEqual({ status: null, confidence: null });
    });

    it('falls back to null instead of throwing when classification/document are absent', () => {
        const item = toTorListItem(sparseProject);
        expect(item.classification).toEqual({ status: null, confidence: null });
        expect(item.documentStatus).toBeNull();
        expect(item.isSoftware).toBe(false);
    });
});

describe('toTorDetail', () => {
    it('maps nested agency/timeline/classification/version for a full project', () => {
        const detail = toTorDetail(fullProject);
        expect(detail.id).toBe('DGA-2563-07-10');
        expect(detail.agency).toEqual({ name: fullProject.dept_name, subName: fullProject.dept_sub_name });
        expect(detail.requirements).toEqual(fullProject.extracted_data.qualifications);
        expect(detail.scopeOfWork).toEqual(fullProject.extracted_data.scope_of_work);
        expect(detail.techStack).toEqual(fullProject.extracted_data.tech_stack);
        expect(detail.version).toEqual({ number: 1, isLatest: true, supersededBy: null });
        expect(detail.anomalies).toEqual(
            fullProject.anomalies.flagged_clauses.map((clause) => ({
                type: 'flagged_clause',
                clauseText: clause.clause_text,
                reason: clause.reason,
            })),
        );
    });

    it('defaults empty arrays/null instead of throwing for a sparse project', () => {
        const detail = toTorDetail(sparseProject);
        expect(detail.agency).toEqual({ name: sparseProject.dept_name, subName: null });
        expect(detail.summary).toBeNull();
        expect(detail.requirements).toEqual([]);
        expect(detail.scopeOfWork).toEqual([]);
        expect(detail.techStack).toEqual([]);
        expect(detail.anomalies).toEqual([]);
        expect(detail.timeline.contractStart).toBeNull();
        expect(detail.timeline.durationDays).toBeNull();
    });
});

describe('toTorSummary', () => {
    it('includes evidence for requirements/scopeOfWork/techStack when present', () => {
        const summary = toTorSummary(fullProject);
        expect(summary.id).toBe('DGA-2563-07-10');
        expect(summary.evidence).toEqual({ requirements: [], scopeOfWork: [], techStack: [] });
    });

    it('defaults to empty evidence arrays for a sparse project', () => {
        const summary = toTorSummary(sparseProject);
        expect(summary.summary).toBeNull();
        expect(summary.evidence).toEqual({ requirements: [], scopeOfWork: [], techStack: [] });
    });
});

describe('toTorAnomalyReport', () => {
    it('reports flagged clauses and the high-budget flag', () => {
        const report = toTorAnomalyReport(fullProject);
        expect(report).toEqual({
            id: 'DGA-2563-07-10',
            highBudgetFlag: false,
            budgetDeviationMultiplier: 1,
            anomalies: fullProject.anomalies.flagged_clauses.map((clause) => ({
                type: 'flagged_clause',
                clauseText: clause.clause_text,
                reason: clause.reason,
            })),
        });
    });

    it('reports high_budget anomalies with a multiplier', () => {
        const highBudget = mockProjectRecords.find((p) => p.project_id === 'TOR-2569-002');
        const report = toTorAnomalyReport(highBudget);
        expect(report.highBudgetFlag).toBe(true);
        expect(report.anomalies).toEqual([
            { type: 'high_budget', budgetDeviationMultiplier: 1.76 },
        ]);
    });

    it('defaults to no anomalies for a sparse project', () => {
        const report = toTorAnomalyReport(sparseProject);
        expect(report).toEqual({
            id: 'TOR-2569-003',
            highBudgetFlag: false,
            budgetDeviationMultiplier: 1,
            anomalies: [],
        });
    });
});
