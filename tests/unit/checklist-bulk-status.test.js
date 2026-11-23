import { describe, expect, it } from 'vitest';
import { updateChecklistStatuses } from '../../lib/bid-prep/checklist.js';

const id = 'a'.repeat(64);

describe('updateChecklistStatuses input checks', () => {
    it.each([
        ['no ids', { itemIds: [], status: 'pass' }],
        ['not a list', { itemIds: id, status: 'pass' }],
        ['bad id', { itemIds: ['xyz'], status: 'pass' }],
        ['null status', { itemIds: [id], status: null }],
        ['unknown status', { itemIds: [id], status: 'maybe' }],
        ['too many ids', { itemIds: Array.from({ length: 201 }, (_, i) => i.toString(16).padStart(64, '0')), status: 'pass' }],
    ])('rejects %s before touching the database', async (_name, body) => {
        const result = await updateChecklistStatuses('user-1', '69099536409', body);
        expect(result.status).toBe(400);
        expect(result.code).toBe('INVALID_CHECKLIST_STATUS');
    });
});
