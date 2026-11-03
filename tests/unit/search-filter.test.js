import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchFilter } from '../../lib/api/query-params.js';

test('empty or non-string queries add no filter', () => {
    assert.deepEqual(buildSearchFilter(''), { filter: {}, usesTextIndex: false });
    assert.deepEqual(buildSearchFilter('   '), { filter: {}, usesTextIndex: false });
    assert.deepEqual(buildSearchFilter(null), { filter: {}, usesTextIndex: false });
});

test('Latin queries use the text index', () => {
    assert.deepEqual(buildSearchFilter(' software '), { filter: { $text: { $search: 'software' } }, usesTextIndex: true });
});

test('Thai queries use an escaped substring match on title and agency', () => {
    const { filter, usesTextIndex } = buildSearchFilter('พัฒนาระบบ (ใหม่)');
    assert.equal(usesTextIndex, false);
    assert.equal(filter.$or.length, 2);
    assert.equal(filter.$or[0].project_name.$regex, 'พัฒนาระบบ \\(ใหม่\\)');
    assert.equal(filter.$or[1].dept_name.$options, 'i');
});

test('project id queries use a prefix match', () => {
    assert.deepEqual(buildSearchFilter('6910906'), { filter: { project_id: { $regex: '^6910906' } }, usesTextIndex: false });
});

test('very long queries are truncated', () => {
    const { filter } = buildSearchFilter('a'.repeat(500));
    assert.equal(filter.$text.$search.length, 200);
});
