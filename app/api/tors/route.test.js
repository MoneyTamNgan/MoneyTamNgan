import { describe, expect, it } from 'vitest';
import { parseDate, parsePositiveInteger } from './route';

describe('parsePositiveInteger', () => {
    it('returns the fallback when the value is null or empty', () => {
        expect(parsePositiveInteger(null, 1, 'page')).toEqual({ value: 1 });
        expect(parsePositiveInteger('', 10, 'limit')).toEqual({ value: 10 });
    });

    it('parses a valid positive integer within bounds', () => {
        expect(parsePositiveInteger('5', 1, 'page')).toEqual({ value: 5 });
    });

    it('rejects zero, negative, non-integer, and out-of-range values', () => {
        expect(parsePositiveInteger('0', 1, 'page').error).toMatch(/page/);
        expect(parsePositiveInteger('-1', 1, 'page').error).toBeDefined();
        expect(parsePositiveInteger('1.5', 1, 'page').error).toBeDefined();
        expect(parsePositiveInteger('abc', 1, 'page').error).toBeDefined();
        expect(parsePositiveInteger('101', 10, 'limit', 100).error).toMatch(/limit/);
    });

    it('accepts the maximum boundary value', () => {
        expect(parsePositiveInteger('100', 10, 'limit', 100)).toEqual({ value: 100 });
    });
});

describe('parseDate', () => {
    it('returns null for an empty value', () => {
        expect(parseDate('', 'dateFrom')).toEqual({ value: null });
        expect(parseDate(undefined, 'dateFrom')).toEqual({ value: null });
    });

    it('parses a valid ISO date', () => {
        const result = parseDate('2026-08-01', 'dateFrom');
        expect(result.error).toBeUndefined();
        expect(result.value).toBeInstanceOf(Date);
    });

    it('rejects an invalid date string', () => {
        expect(parseDate('not-a-date', 'dateFrom').error).toMatch(/dateFrom/);
    });

    it('bumps a bare date to end-of-day when endOfDay is set', () => {
        const result = parseDate('2026-08-01', 'dateTo', true);
        expect(result.value.getUTCHours()).toBe(23);
        expect(result.value.getUTCMinutes()).toBe(59);
    });
});
