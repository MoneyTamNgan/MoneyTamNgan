import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeThaiDigits, thaiBahtWords, financialAmounts, moneyWarnings, financialDisagreement } from '../lib/ocr-quality.js';
import { chooseOcrCandidate } from '../lib/text-extraction.js';

test('Thai currency words and digits agree for representative amounts', () => {
    assert.equal(normalizeThaiDigits('๘๐,๐๐๐,๐๐๐.๐๐'), '80,000,000.00');
    assert.equal(thaiBahtWords('แปดสิบล้านบาทถ้วน'), 80000000);
    assert.equal(thaiBahtWords('สองร้อยสิบเจ็ดล้านสองแสนหนึ่งหมื่นสี่พันสามร้อยบาทถ้วน'), 217214300);
    assert.equal(thaiBahtWords('ยี่สิบเอ็ดบาทห้าสิบสตางค์'), 21.5);
    assert.equal(thaiBahtWords('หนึ่งร้อยเอ็ดบาทถ้วน'), 101);
    assert.equal(thaiBahtWords('ศูนย์บาทถ้วน'), 0);
    assert.equal(thaiBahtWords('ข้อความอ่านผิดบาทถ้วน'), null);
    assert.equal(moneyWarnings('๘๐,๐๐๐,๐๐๐.๐๐ บาท (แปดสิบล้านบาทถ้วน)').length, 0);
});

test('the observed 80-million versus 50-million error becomes a review warning', () => {
    const warnings = moneyWarnings('กว่า ๕๐,๐๐๐,๐๐๐.๐๐ บาท (แปดสิบล้านบาทถ้วน) ต่อสัญญา');
    assert.equal(warnings[0].code, 'amount_words_mismatch');
    assert.equal(warnings[0].amount, 50000000);
    assert.equal(warnings[0].writtenAmount, 80000000);
    assert.equal(moneyWarnings('๕๐ , ๐๐๐ , ๐๐๐ . ๐๐ บาท (แปดสิบล้านบาทถ้วน)')[0].code, 'amount_words_mismatch');
    assert.deepEqual(moneyWarnings('20 ล้านบาท\n(3)'), []);
});

test('financial comparisons normalize Thai digits and million units', () => {
    assert.equal(financialAmounts('ทุน ๖๐ ล้านบาท')[0].amount, 60000000);
    assert.equal(financialDisagreement('๘๐ ล้านบาท', '80,000,000 บาท'), false);
    assert.equal(financialDisagreement('๘๐ ล้านบาท', '50,000,000 บาท'), true);
    assert.equal(financialDisagreement('80 ล้านบาท', ''), true);
});

test('secondary OCR may be selected but disagreements are retained for review', () => {
    const primary = { text: 'ผลงาน '.repeat(10) + '๕๐,๐๐๐,๐๐๐ บาท (แปดสิบล้านบาทถ้วน)', confidence: 0.98, psm: 3 };
    const secondary = { text: 'ผลงาน '.repeat(10) + '๘๐,๐๐๐,๐๐๐ บาท (แปดสิบล้านบาทถ้วน)', confidence: 0.92, psm: 6 };
    const result = chooseOcrCandidate(primary, secondary);
    assert.equal(result.psm, 6);
    assert.equal(result.candidates.length, 2);
    assert.equal(result.needs_review, true);
    assert.ok(result.warnings.some(w => w.code === 'ocr_amount_disagreement'));
    assert.ok(result.warnings.some(w => w.code === 'amount_words_mismatch'));
    assert.equal(primary.text.includes('๕๐,'), true);
});

test('agreement and high confidence cannot automatically approve financial OCR', () => {
    const candidate = { text: 'รายละเอียด '.repeat(10) + '80 ล้านบาท', confidence: 0.99, psm: 3 };
    const result = chooseOcrCandidate(candidate, { ...candidate, psm: 6 });
    assert.equal(result.needs_review, true);
    assert.ok(result.warnings.some(w => w.code === 'financial_ocr_requires_review'));
});

test('unreadable amount wording and contradictory embedded text remain visible', () => {
    assert.equal(moneyWarnings('80 บาท (อ่านผิดบาท)')[0].code, 'amount_words_unreadable');
    const result = chooseOcrCandidate({ text: 'ยอดรวม '.repeat(10) + '50 ล้านบาท', confidence: 0.9, psm: 3 }, null,
        'ยอดรวม '.repeat(10) + '80 ล้านบาท');
    assert.ok(result.warnings.some(w => w.code === 'embedded_amount_disagreement'));
});
