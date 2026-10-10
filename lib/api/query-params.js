/** Query-string parsers shared by the public list and analytics endpoints. */

export function parsePositiveInteger(value, fallback, name, max = Number.MAX_SAFE_INTEGER) {
    if (value === null || value === '') return { value: fallback };
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
        return { error: `${name} must be an integer between 1 and ${max}` };
    }
    return { value: parsed };
}

export function parseNonNegativeNumber(value, name) {
    if (value === null || value === '') return { value: null };
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return { error: `${name} must be a non-negative number` };
    }
    return { value: parsed };
}

export function parseDate(value, name, endOfDay = false) {
    if (!value) return { value: null };
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return { error: `${name} must be a valid ISO 8601 date` };
    }
    if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        parsed.setUTCHours(23, 59, 59, 999);
    }
    return { value: parsed };
}
