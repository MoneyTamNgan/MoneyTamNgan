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
        expect(item.contractStart).toBeNull();
        expect(item.contractEnd).toBeNull();
        expect(item.bidding).toEqual({
            status: 'unknown',
            phase: null,
            opensAt: null,
            closesAt: null,
            submissionDate: null,
            submissionStartTime: null,
            submissionEndTime: null,
            invitationUrl: null,
            method: null,
        });
        expect(item.classification).toEqual({ status: null, confidence: null });
        expect(item.techStack).toEqual(fullProject.extracted_data.tech_stack);
        expect(item.anomaly).toEqual({ highBudgetFlag: false, budgetDeviationMultiplier: 1 });
    });

    it('falls back to null instead of throwing when classification/document are absent', () => {
        const item = toTorListItem(sparseProject);
        expect(item.classification).toEqual({ status: null, confidence: null });
        expect(item.documentStatus).toBeNull();
        expect(item.isSoftware).toBe(false);
        expect(item.processingStatus).toBeNull();
        expect(item.techStack).toEqual([]);
        expect(item.anomaly).toEqual({ highBudgetFlag: false, budgetDeviationMultiplier: 1 });
    });

    it('uses tender data for the bidding fields without relying on contract dates', () => {
        const project = {
            ...sparseProject,
            timeline: { announce_date: '2000-09-28T17:00:00.000Z' },
            tender: {
                status: 'closed',
                closes_at: '2000-10-05T05:00:00.000Z',
                submission_date: '2000-10-05',
                submission_start_time: '09:00',
                submission_end_time: '12:00',
                invitation_url: 'https://example.test/invitation.pdf',
                method: 'ประกวดราคาอิเล็กทรอนิกส์ (e-bidding)',
            },
        };

        expect(toTorListItem(project).bidding).toEqual({
            status: 'closed',
            phase: 'closed',
            opensAt: '2000-10-05T02:00:00.000Z',
            closesAt: '2000-10-05T05:00:00.000Z',
            submissionDate: '2000-10-05',
            submissionStartTime: '09:00',
            submissionEndTime: '12:00',
            invitationUrl: 'https://example.test/invitation.pdf',
            method: 'ประกวดราคาอิเล็กทรอนิกส์ (e-bidding)',
        });
    });

    it('calculates live bidding status from the exact submission session deadline', () => {
        const openProject = {
            ...sparseProject,
            tender: { status: 'closed', closes_at: '2000-10-08T05:00:00.000Z' },
            submission_schedule: {
                date: '2099-10-08', start_time: '09:00', end_time: '12:00',
            },
        };
        const closedProject = {
            ...sparseProject,
            tender: { status: 'open' },
            submission_schedule: {
                date: '2000-10-08', start_time: '09:00', end_time: '12:00',
            },
        };

        expect(toTorListItem(openProject).bidding).toMatchObject({
            status: 'open', opensAt: '2099-10-08T02:00:00.000Z', closesAt: '2099-10-08T05:00:00.000Z',
        });
        expect(toTorListItem(closedProject).bidding.status).toBe('closed');
    });

    it('uses tender reference price, then null, when a project budget is absent', () => {
        expect(toTorListItem({ ...sparseProject, budget: undefined, tender: { reference_price: 125000 } }).budget).toBe(125000);
        expect(toTorListItem({ ...sparseProject, budget: undefined }).budget).toBeNull();
    });
});

describe('toTorDetail', () => {
    it('maps nested agency/timeline/classification/version for a full project', () => {
        const detail = toTorDetail(fullProject);
        expect(detail.id).toBe('DGA-2563-07-10');
        expect(detail.pdfUrl).toBe(fullProject.pdf_url);
        expect(detail.createdAt).toBeNull();
        expect(detail.updatedAt).toBeNull();
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
                explanation: clause.reason,
            })),
        );
    });

    it('defaults empty arrays/null instead of throwing for a sparse project', () => {
        const detail = toTorDetail(sparseProject);
        expect(detail.agency).toEqual({ name: sparseProject.dept_name, subName: null });
        expect(detail.summary).toBeNull();
        expect(detail.pdfUrl).toBeNull();
        expect(detail.createdAt).toBe(new Date(sparseProject.created_at).toISOString());
        expect(detail.updatedAt).toBe(new Date(sparseProject.updated_at).toISOString());
        expect(detail.requirements).toEqual([]);
        expect(detail.scopeOfWork).toEqual([]);
        expect(detail.techStack).toEqual([]);
        expect(detail.anomalies).toEqual([]);
        expect(detail.timeline.contractStart).toBeNull();
        expect(detail.timeline.durationDays).toBeNull();
        expect(detail.bidding).toMatchObject({ status: 'unknown', phase: null });
    });

    it('keeps the tender phase separate from the deadline-derived bidding status', () => {
        const detail = toTorDetail({
            ...sparseProject,
            tender: { status: 'bidding_open' },
            submission_schedule: { date: '2099-10-08', start_time: '09:00', end_time: '12:00' },
        });

        expect(detail.bidding).toMatchObject({
            phase: 'bidding_open',
            status: 'open',
            opensAt: '2099-10-08T02:00:00.000Z',
            closesAt: '2099-10-08T05:00:00.000Z',
        });
    });

    it('exposes safe metadata for linked TOR and invitation documents', () => {
        const detail = toTorDetail({
            ...sparseProject,
            documents: {
                tor: {
                    id: 'tor-document', type: 'tor', filename: 'TOR.pdf',
                    sourceUrl: 'https://example.test/tor.pdf', mimeType: 'application/pdf',
                    sizeBytes: 42, status: 'stored', version: 2, isCurrentPrimary: true,
                },
                announcement: {
                    id: 'announcement-document', type: 'announcement', filename: 'Invitation.pdf',
                    sourceUrl: 'https://example.test/invitation.pdf', mimeType: 'application/pdf',
                    sizeBytes: 24, status: 'stored', version: 1, isCurrentPrimary: false,
                },
            },
        });

        expect(detail.documents).toEqual({
            tor: expect.objectContaining({ id: 'tor-document', filename: 'TOR.pdf', sourceUrl: 'https://example.test/tor.pdf' }),
            announcement: expect.objectContaining({ id: 'announcement-document', filename: 'Invitation.pdf', sourceUrl: 'https://example.test/invitation.pdf' }),
        });
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
                explanation: clause.reason,
            })),
        });
    });

    it('exposes structured Vertex risk fields without removing the legacy reason', () => {
        const project = structuredClone(sparseProject);
        project.anomalies.flagged_clauses = [{
            category: 'vendor_lock_in', severity: 'high',
            clause_text: 'ต้องใช้ Brand X เท่านั้น', reason: 'ล็อกผู้ขายรายเดียว',
            explanation: 'ล็อกผู้ขายรายเดียว', highlight_reason: 'ไม่มีผลิตภัณฑ์เทียบเท่า',
            page: 8, confidence: 0.93,
        }];
        expect(toTorAnomalyReport(project).anomalies[0]).toEqual({
            type: 'flagged_clause', category: 'vendor_lock_in', severity: 'high',
            clauseText: 'ต้องใช้ Brand X เท่านั้น', reason: 'ล็อกผู้ขายรายเดียว',
            explanation: 'ล็อกผู้ขายรายเดียว', highlightReason: 'ไม่มีผลิตภัณฑ์เทียบเท่า',
            page: 8, confidence: 0.93,
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
