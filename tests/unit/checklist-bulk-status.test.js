import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { updateChecklistStatuses } from '../../lib/bid-prep/checklist.js';

const id = 'a'.repeat(64);

describe('updateChecklistStatuses input checks', () => {
    const cases = [
        ['no ids', { itemIds: [], status: 'pass' }],
        ['not a list', { itemIds: id, status: 'pass' }],
        ['bad id', { itemIds: ['xyz'], status: 'pass' }],
        ['null status', { itemIds: [id], status: null }],
        ['unknown status', { itemIds: [id], status: 'maybe' }],
        ['too many ids', { itemIds: Array.from({ length: 201 }, (_, i) => i.toString(16).padStart(64, '0')), status: 'pass' }],
    ];
    for (const [name, body] of cases) {
        test(`rejects ${name} before touching the database`, async () => {
            const result = await updateChecklistStatuses('user-1', '69099536409', body);
            assert.equal(result.status, 400);
            assert.equal(result.code, 'INVALID_CHECKLIST_STATUS');
        });
    }
});
