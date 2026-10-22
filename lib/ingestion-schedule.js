/**
 * Scheduling and retry policy for the automated ingestion runner (FR-1.1.1).
 *
 * Pure functions only, so the runner and /api/ingestion/status share the same
 * schedule and the policy can be tested without a clock or a database.
 */

export const DEFAULT_SCHEDULE = '06:00,12:00,18:00';
export const DEFAULT_TIMEZONE = 'Asia/Bangkok';
export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_RETRY_BASE_MS = 5 * 60 * 1000;
export const RETRY_FACTOR = 3;
export const RETRY_JITTER = 0.2;

const MINUTE_MS = 60 * 1000;
const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const TRANSIENT_NETWORK_CODES = new Set([
    'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'ETIMEDOUT', 'EPIPE',
    'EAI_AGAIN', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH',
    'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET',
]);

/**
 * Parse `INGESTION_SCHEDULE`: either comma-separated wall-clock times
 * ("06:00,12:00,18:00") or a fixed interval ("every:1h", "every:30m").
 */
export function parseSchedule(spec = DEFAULT_SCHEDULE) {
    const value = String(spec).trim();
    const interval = value.match(/^every:(\d+)(m|h)$/i);
    if (interval) {
        const minutes = Number(interval[1]) * (interval[2].toLowerCase() === 'h' ? 60 : 1);
        if (minutes < 5 || minutes > 24 * 60) throw new RangeError('Ingestion interval must be between 5m and 24h');
        return { type: 'interval', intervalMs: minutes * MINUTE_MS };
    }

    const times = value.split(',').map(part => part.trim()).filter(Boolean).map(part => {
        const match = part.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
        if (!match) throw new RangeError(`Invalid ingestion time "${part}" (expected HH:MM)`);
        return Number(match[1]) * 60 + Number(match[2]);
    });
    if (!times.length) throw new RangeError('Ingestion schedule is empty');
    return { type: 'times', minutes: [...new Set(times)].sort((a, b) => a - b) };
}

/** Minutes east of UTC for `timeZone` at `date` (420 for Asia/Bangkok). */
export function timeZoneOffsetMinutes(date, timeZone) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone, hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(date).map(part => [part.type, part.value]));
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / MINUTE_MS);
}

/** The first scheduled run strictly after `after`. */
export function nextRunAt(schedule, after = new Date(), timeZone = DEFAULT_TIMEZONE) {
    const afterMs = after.getTime();
    if (schedule.type === 'interval') {
        // Align interval slots to local midnight so restarts keep the same slots.
        const offsetMs = timeZoneOffsetMinutes(after, timeZone) * MINUTE_MS;
        return new Date((Math.floor((afterMs + offsetMs) / schedule.intervalMs) + 1) * schedule.intervalMs - offsetMs);
    }

    const offsetMs = timeZoneOffsetMinutes(after, timeZone) * MINUTE_MS;
    const local = new Date(afterMs + offsetMs);
    const localMidnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
    for (let day = 0; day <= 2; day++) {
        for (const minute of schedule.minutes) {
            const localSlot = localMidnight + day * 24 * 60 * MINUTE_MS + minute * MINUTE_MS;
            const slot = localSlot - timeZoneOffsetMinutes(new Date(localSlot - offsetMs), timeZone) * MINUTE_MS;
            if (slot > afterMs) return new Date(slot);
        }
    }
    throw new Error('Could not compute the next ingestion run');
}

/** Exponential backoff with jitter: ~5 min, ~15 min, ~45 min for attempts 1..3. */
export function retryDelayMs(retryNumber, { baseMs = DEFAULT_RETRY_BASE_MS, random = Math.random } = {}) {
    const delay = baseMs * RETRY_FACTOR ** (retryNumber - 1);
    return Math.round(delay * (1 + (random() * 2 - 1) * RETRY_JITTER));
}

/**
 * Only network errors, timeouts and upstream 5xx/429 are worth retrying.
 * Errors may carry an explicit `retryable` flag, which always wins.
 */
export function isTransientError(error) {
    if (typeof error?.retryable === 'boolean') return error.retryable;
    if (['AbortError', 'TimeoutError', 'MongoNetworkError', 'MongoServerSelectionError'].includes(error?.name)) return true;
    const status = Number(error?.status);
    if (status) return TRANSIENT_HTTP_STATUSES.has(status);
    const code = String(error?.code || error?.cause?.code || '').toUpperCase();
    if (TRANSIENT_NETWORK_CODES.has(code)) return true;
    return error instanceof TypeError && /fetch failed/i.test(error.message);
}

/**
 * Run `attempt` until it succeeds, a permanent error occurs, retries run out,
 * or the next retry would start at/after the next scheduled run.
 */
export async function runWithRetries(attempt, {
    maxRetries = DEFAULT_MAX_RETRIES,
    nextScheduledAt,
    retryBaseMs = DEFAULT_RETRY_BASE_MS,
    now = () => new Date(),
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
    random = Math.random,
    onRetryScheduled = async () => {},
} = {}) {
    for (let attemptNumber = 1; ; attemptNumber++) {
        try {
            return { ok: true, attempts: attemptNumber, result: await attempt(attemptNumber) };
        } catch (error) {
            const transient = isTransientError(error);
            if (!transient) return { ok: false, attempts: attemptNumber, error, transient, reason: 'permanent_error' };
            if (attemptNumber > maxRetries) return { ok: false, attempts: attemptNumber, error, transient, reason: 'retries_exhausted' };

            const delayMs = retryDelayMs(attemptNumber, { baseMs: retryBaseMs, random });
            const retryAt = new Date(now().getTime() + delayMs);
            if (nextScheduledAt && retryAt >= nextScheduledAt) {
                return { ok: false, attempts: attemptNumber, error, transient, reason: 'overlaps_next_run' };
            }
            await onRetryScheduled({ attemptNumber, error, retryAt, delayMs });
            await sleep(delayMs);
        }
    }
}

export function ingestionScheduleConfig(env = process.env) {
    const spec = env.INGESTION_SCHEDULE || DEFAULT_SCHEDULE;
    return {
        spec,
        schedule: parseSchedule(spec),
        timeZone: env.INGESTION_TIMEZONE || DEFAULT_TIMEZONE,
        maxRetries: env.INGESTION_MAX_RETRIES === undefined ? DEFAULT_MAX_RETRIES : Number(env.INGESTION_MAX_RETRIES),
        retryBaseMs: env.INGESTION_RETRY_BASE_MS === undefined ? DEFAULT_RETRY_BASE_MS : Number(env.INGESTION_RETRY_BASE_MS),
    };
}
