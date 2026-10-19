import { describe, expect, it } from 'vitest';
import {
    EXPORT_COLUMNS,
    loadExportRows,
    parseAnalyticsFilter,
    toCsv,
    toExportRow,
    toSpendAggregates,
} from '@/lib/analytics';

const params = query => new URLSearchParams(query);

describe('parseAnalyticsFilter', () => {
    it('builds a Project filter from public query parameters', () => {
        const { filter } = parseAnalyticsFilter(params(
            'agency=สำนักการคลัง&category=software&dateFrom=2026-01-01&dateTo=2026-06-30&budgetMin=1000&budgetMax=5000'
        ));
        expect(filter).toMatchObject({
            dept_name: 'สำนักการคลัง',
            is_software: true,
            budget: { $gte: 1000, $lte: 5000 },
        });
        expect(filter['timeline.announce_date'].$gte.toISOString()).toBe('2026-01-01T00:00:00.000Z');
        expect(filter['timeline.announce_date'].$lte.toISOString()).toBe('2026-06-30T23:59:59.999Z');
        expect(parseAnalyticsFilter(params('category=non-software')).filter).toEqual({ is_software: false });
    });

    it('rejects invalid ranges and categories', () => {
        expect(parseAnalyticsFilter(params('category=hardware')).error.code).toBe('INVALID_CATEGORY');
        expect(parseAnalyticsFilter(params('budgetMin=10&budgetMax=1')).error.code).toBe('INVALID_BUDGET_RANGE');
        expect(parseAnalyticsFilter(params('dateFrom=2026-02-01&dateTo=2026-01-01')).error.code).toBe('INVALID_DATE_RANGE');
        expect(parseAnalyticsFilter(params('dateFrom=nope')).error.code).toBe('INVALID_DATE_FROM');
    });
});

describe('toSpendAggregates', () => {
    it('shapes facet output and defaults an empty result to zeros', () => {
        expect(toSpendAggregates(undefined)).toEqual({
            projectCount: 0, totalSpend: 0, meanBudget: 0, medianDuration: null,
            softwareCount: 0, summarizedCount: 0, anomalyCount: 0,
            byAgency: [], byStatus: [], topTechnologies: [],
        });
        const aggregates = toSpendAggregates({
            totals: [{ projectCount: 3, totalSpend: 10, meanBudget: 3.3333, medianDuration: 180,
                softwareCount: 2, highBudgetCount: 1, summarizedCount: 2 }],
            byAgency: [{ _id: 'A', projectCount: 2, totalSpend: 8, meanBudget: 4 }],
            byStatus: [{ _id: 'Active', projectCount: 3 }],
            technologies: [{ _id: 'React', projectCount: 2 }],
            flaggedOnly: [{ count: 1 }],
        });
        expect(aggregates).toMatchObject({
            meanBudget: 3.33,
            anomalyCount: 2,
            byAgency: [{ agency: 'A', projectCount: 2, totalSpend: 8, meanBudget: 4 }],
            byStatus: [{ status: 'Active', projectCount: 3 }],
            topTechnologies: [{ technology: 'React', projectCount: 2 }],
        });
    });
});

describe('exports', () => {
    const project = {
        project_id: '69010000001',
        project_name: 'ระบบ "สารบรรณ", ระยะที่ 2',
        dept_name: '=HYPERLINK("http://evil")',
        budget: 1500000,
        timeline: { announce_date: new Date('2026-01-05T00:00:00Z'), duration_days: 120 },
        anomalies: { high_budget_flag: true, budget_deviation_multiplier: 1.8 },
    };

    it('flattens a project into the export columns', () => {
        const row = toExportRow(project);
        expect(Object.keys(row)).toEqual(EXPORT_COLUMNS);
        expect(row).toMatchObject({ id: '69010000001', budget: 1500000, announceDate: '2026-01-05T00:00:00.000Z',
            projectStatus: 'Active', highBudgetFlag: true, contractStart: null });
    });

    it('writes Excel-safe CSV with a BOM, quoting, and formula neutralization', () => {
        const csv = toCsv([toExportRow(project)]);
        const [header, line] = csv.replace('﻿', '').trim().split('\r\n');
        expect(csv.startsWith('﻿')).toBe(true);
        expect(header).toBe(EXPORT_COLUMNS.join(','));
        expect(line).toContain('"ระบบ ""สารบรรณ"", ระยะที่ 2"');
        expect(line).toContain(`"'=HYPERLINK(""http://evil"")"`);
        expect(line).not.toMatch(/,=/);
    });

    it('reports truncation when more rows match than the limit', async () => {
        const ProjectModel = { aggregate: async pipeline => {
            const { $limit } = pipeline.at(-1);
            return Array.from({ length: Math.min($limit, 5) }, (_, index) => ({ ...project, project_id: String(index) }));
        } };
        expect(await loadExportRows(ProjectModel, {}, 3)).toMatchObject({ truncated: true });
        expect((await loadExportRows(ProjectModel, {}, 3)).rows).toHaveLength(3);
        expect((await loadExportRows(ProjectModel, {}, 10)).truncated).toBe(false);
    });
});
