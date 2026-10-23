import { describe, expect, it } from 'vitest';
import { buildAnalyticsPipeline, parseAnalyticsQuery } from '@/lib/analytics/project-analytics';

function params(query = '') {
    return new URLSearchParams(query);
}

describe('parseAnalyticsQuery', () => {
    it('uses dashboard-safe defaults', () => {
        expect(parseAnalyticsQuery(params()).value).toMatchObject({ page: 1, limit: 10, isSoftware: null });
    });

    it('parses analytics filters', () => {
        expect(parseAnalyticsQuery(params('isSoftware=true&biddingStatus=open&fiscalYear=2569&page=2&limit=20')).value).toMatchObject({
            isSoftware: true, biddingStatus: 'open', fiscalYear: 2569, page: 2, limit: 20,
        });
    });

    it('rejects unsupported derived filter values', () => {
        expect(parseAnalyticsQuery(params('biddingStatus=pending')).code).toBe('INVALID_BIDDING_STATUS');
        expect(parseAnalyticsQuery(params('fiscalYear=2026')).code).toBe('INVALID_FISCAL_YEAR');
    });
});

describe('buildAnalyticsPipeline', () => {
    it('contains deduplication and tender-derived bidding fields', () => {
        const filters = parseAnalyticsQuery(params('isSoftware=true&biddingStatus=open&fiscalYear=2569')).value;
        const pipeline = buildAnalyticsPipeline(filters, new Date('2026-10-05T00:00:00.000Z'));
        expect(pipeline.some((stage) => stage.$group?._id === '$project_id')).toBe(true);
        expect(pipeline.some((stage) => stage.$addFields?.analyticsBiddingStatus)).toBe(true);
        expect(pipeline.some((stage) => stage.$match?.tender)).toBe(true);
        expect(pipeline.at(-1)).toEqual({ $match: { analyticsBiddingStatus: 'open', analyticsFiscalYear: 2569 } });
    });
});
