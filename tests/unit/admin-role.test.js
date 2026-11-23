import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { changeUserRole } from '../../lib/admin-role.js';

function fakeUserModel(rows) {
    const calls = [];
    return {
        calls,
        findOne: filter => ({ select: async () => rows.find(row => row.email === filter.email) ?? null }),
        findOneAndUpdate: async (filter, update) => {
            calls.push({ filter, update });
            const row = rows.find(r => r._id === filter._id);
            Object.assign(row, update.$set);
            return row;
        },
    };
}

describe('changeUserRole', () => {
    test('promoting bumps session_version and records one audit entry', async () => {
        const User = fakeUserModel([{ _id: 'u1', email: 'a@example.test', role: 'user' }]);
        const entries = [];
        const result = await changeUserRole({ User, email: ' A@Example.test ', role: 'admin', actor: 'me@host', record: async e => entries.push(e) });
        assert.equal(result.changed, true);
        assert.equal(result.previousRole, 'user');
        assert.deepEqual(User.calls[0].update.$inc, { session_version: 1 });
        assert.equal(User.calls[0].update.$set.role, 'admin');
        assert.equal(entries.length, 1);
        assert.deepEqual([entries[0].event, entries[0].from, entries[0].to, entries[0].actor], ['role_changed', 'user', 'admin', 'me@host']);
    });

    test('demoting also bumps session_version so the old token stops working', async () => {
        const User = fakeUserModel([{ _id: 'u2', email: 'b@example.test', role: 'admin' }]);
        const result = await changeUserRole({ User, email: 'b@example.test', role: 'user' });
        assert.equal(result.changed, true);
        assert.deepEqual(User.calls[0].update.$inc, { session_version: 1 });
    });

    test('asking for the role the account already has changes nothing and records nothing', async () => {
        const User = fakeUserModel([{ _id: 'u3', email: 'c@example.test', role: 'admin' }]);
        const entries = [];
        const result = await changeUserRole({ User, email: 'c@example.test', role: 'admin', record: async e => entries.push(e) });
        assert.equal(result.changed, false);
        assert.equal(User.calls.length, 0);
        assert.equal(entries.length, 0);
    });

    test('an unknown account is reported as not found', async () => {
        const result = await changeUserRole({ User: fakeUserModel([]), email: 'nobody@example.test', role: 'admin' });
        assert.deepEqual(result, { found: false, changed: false });
    });

    test('rejects roles other than user and admin', async () => {
        await assert.rejects(() => changeUserRole({ User: fakeUserModel([]), email: 'a@example.test', role: 'root' }), RangeError);
    });
});
