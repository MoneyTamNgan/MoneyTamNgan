import { createRateLimiter } from '../rate-limit.js';

export const PROPOSAL_DRAFT_WINDOW_MS = 60 * 60 * 1000;

export function proposalDraftLimitPerHour(env = process.env) {
    const value = Number(env.PROPOSAL_DRAFT_LIMIT_PER_HOUR);
    return Number.isInteger(value) && value > 0 ? value : 5;
}

export function createProposalDraftLimiter({ now = Date.now, windowMs = PROPOSAL_DRAFT_WINDOW_MS } = {}) {
    const limiter = createRateLimiter({ windowMs, now });
    return {
        take(userId, limit = proposalDraftLimitPerHour()) {
            return limiter.hit(`proposal-draft:${userId}`, limit);
        },
    };
}

let active = createProposalDraftLimiter();

export function takeProposalDraftSlot(userId, env = process.env) {
    return active.take(userId, proposalDraftLimitPerHour(env));
}

export function resetProposalDraftLimiter(options) {
    active = createProposalDraftLimiter(options);
}
