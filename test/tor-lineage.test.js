import assert from 'node:assert/strict';
import test from 'node:test';
import {
    groupRevisions,
    lineageKey,
    linkAllProjectRevisions,
    linkProjectRevisions,
    normalizeTitle,
    planLineage,
} from '../lib/tor-lineage.js';

const project = (id, title, date, extra = {}) => ({
    project_id: id,
    project_name: title,
    dept_name: 'สำนักการคลัง',
    project_status: 'Active',
    timeline: { announce_date: new Date(`${date}T00:00:00+07:00`) },
    ...extra,
});

/** Minimal in-memory Project model covering the calls tor-lineage makes. */
function fakeProjectModel(records) {
    const matches = (record, filter) => Object.entries(filter).every(([field, condition]) => {
        const value = record[field];
        if (condition?.$in) return condition.$in.includes(value);
        if (condition?.$nin) return !condition.$nin.includes(value);
        if (condition?.$exists !== undefined) return (value !== undefined) === condition.$exists;
        return value === condition;
    });
    const query = filter => ({
        select: () => ({ lean: async () => records.filter(record => matches(record, filter)).map(record => structuredClone(record)) }),
    });
    return {
        records,
        find: query,
        async bulkWrite(operations) {
            for (const { updateMany: { filter, update } } of operations) {
                for (const record of records.filter(item => matches(item, filter))) {
                    for (const [path, value] of Object.entries(update.$set)) {
                        const [head, tail] = path.split('.');
                        if (tail) record[head] = { ...(record[head] || {}), [tail]: value };
                        else record[head] = value;
                    }
                }
            }
        },
    };
}

test('normalizeTitle ignores spacing, punctuation, Thai digits, and re-announcement markers', () => {
    const base = normalizeTitle('จ้างพัฒนาระบบบริหารจัดการทรัพย์สิน ปี 2569');
    assert.equal(normalizeTitle('จ้างพัฒนาระบบบริหารจัดการทรัพย์สิน  ปี ๒๕๖๙ (ครั้งที่ 2)'), base);
    assert.equal(normalizeTitle('จ้างพัฒนาระบบบริหารจัดการทรัพย์สิน, ปี 2569 (ฉบับแก้ไข)'), base);
    assert.notEqual(normalizeTitle('จ้างพัฒนาระบบบริหารจัดการพัสดุ ปี 2569'), base);
});

test('lineageKey requires an agency and separates agencies with the same title', () => {
    const a = project('1', 'ระบบสารบรรณ', '2026-01-01');
    assert.equal(lineageKey(a), lineageKey({ ...a, project_id: '2' }));
    assert.notEqual(lineageKey(a), lineageKey({ ...a, dept_name: 'สำนักการโยธา' }));
    assert.equal(lineageKey({ ...a, dept_name: undefined }), null);
    assert.ok(lineageKey({ ...a, dept_name: undefined, tender: { rss_dept_id: '1507' } }));
});

test('planLineage links revisions oldest to newest and supersedes all but the latest', () => {
    const lineage = groupRevisions([
        project('69030000003', 'ระบบสารบรรณ (ครั้งที่ 3)', '2026-03-01'),
        project('69010000001', 'ระบบสารบรรณ', '2026-01-01'),
        project('69020000002', 'ระบบสารบรรณ (ครั้งที่ 2)', '2026-02-01', { project_status: 'Cancelled' }),
    ])[0];
    const plan = planLineage(lineage);
    assert.deepEqual(plan.map(entry => [entry.project.project_id, entry.versionInfo.version, entry.status]), [
        ['69010000001', 1, 'Superseded'],
        ['69020000002', 2, 'Superseded'],
        ['69030000003', 3, 'Active'],
    ]);
    assert.deepEqual(plan[1].versionInfo, {
        version: 2,
        is_latest: false,
        lineage_id: '69010000001',
        supersedes: '69010000001',
        superseded_by: '69030000003',
    });
});

test('groupRevisions starts a new lineage after a long gap between announcements', () => {
    const lineages = groupRevisions([
        project('1', 'จ้างบำรุงรักษาระบบ', '2025-01-10'),
        project('2', 'จ้างบำรุงรักษาระบบ', '2026-01-10'),
    ]);
    assert.equal(lineages.length, 2);
});

test('linkProjectRevisions links a new re-announcement to the stored original', async () => {
    const model = fakeProjectModel([
        project('69010000001', 'ระบบสารบรรณอิเล็กทรอนิกส์', '2026-01-01', { project_status: 'Cancelled' }),
        project('69010000009', 'ระบบอื่น', '2026-01-01'),
    ]);
    await linkAllProjectRevisions({ ProjectModel: model });
    model.records.push(project('69020000002', 'ระบบสารบรรณอิเล็กทรอนิกส์ (ครั้งที่ 2)', '2026-02-15'));

    const stats = await linkProjectRevisions(['69020000002'], { ProjectModel: model });
    const [v1, other, v2] = model.records;
    assert.equal(stats.lineages, 1);
    assert.equal(v1.project_status, 'Superseded');
    assert.equal(v1.version_info.superseded_by, '69020000002');
    assert.equal(v1.version_info.status_before_superseded, 'Cancelled');
    assert.equal(v2.project_status, 'Active');
    assert.equal(v2.version_info.version, 2);
    assert.equal(v2.version_info.supersedes, '69010000001');
    assert.equal(other.version_info.lineage_id, null);

    // A title correction moves v2 out of the lineage, restoring v1.
    v2.project_name = 'ระบบบริหารงานบุคคล';
    await linkProjectRevisions(['69020000002'], { ProjectModel: model });
    assert.equal(v1.project_status, 'Cancelled');
    assert.equal(v1.version_info.is_latest, true);
    assert.equal(v1.version_info.superseded_by, null);
    assert.equal(v2.version_info.supersedes, null);
});

test('linkAllProjectRevisions writes nothing when lineages are already current', async () => {
    const model = fakeProjectModel([
        project('1', 'ระบบสารบรรณ', '2026-01-01'),
        project('2', 'ระบบสารบรรณ (ครั้งที่ 2)', '2026-02-01'),
    ]);
    assert.equal((await linkAllProjectRevisions({ ProjectModel: model })).updated, 2);
    assert.equal((await linkAllProjectRevisions({ ProjectModel: model })).updated, 0);
});
