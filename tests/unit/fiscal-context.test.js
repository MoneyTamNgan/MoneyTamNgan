import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { evaluateFiscalDataset } from '../../scripts/evaluate-fiscal-budget.js';
import { resolveFiscalBudget } from '../../lib/fiscal-budget.js';

test('context selection matches labeled synthetic fiscal cases without claiming production accuracy', async () => {
    const cases = JSON.parse(await readFile(new URL('./fixtures/fiscal-context-cases.json', import.meta.url), 'utf8'));
    const report = evaluateFiscalDataset(cases);
    assert.equal(report.caseCount, 24);
    assert.equal(report.contextAware.failures.length, 0);
    assert.ok(report.contextAware.exactMatches > report.baseline.exactMatches);
    assert.match(report.limitation, /not production accuracy/);
});

test('historical evidence stays auditable but cannot be selected even when returned by LLM', () => {
    const pages = [{ page_number: 1, text: '9. ประวัติโครงการ\nอ้างอิงปีงบประมาณ 2568' }];
    const result = resolveFiscalBudget(pages, [{ year: 2568, page: 1, clause_text: 'ปีงบประมาณ 2568' }]);
    assert.deepEqual(result.years, []);
    assert.equal(result.method, 'none');
    assert.ok(result.evidence.every(item => !item.selected && !item.eligible));
    assert.ok(result.warnings.includes('fiscal_context_requires_review'));
});

test('human-reviewed evaluation cases require reviewer provenance', () => {
    assert.throws(() => evaluateFiscalDataset([{ id: 'x', label_source: 'human_reviewed', pages: [], expected: { years: [], status: 'not_found' } }]), /Invalid/);
});
