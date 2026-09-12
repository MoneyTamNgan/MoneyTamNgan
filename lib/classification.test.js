import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    classifyTor,
    applySoftwareFlag,
    DEFAULT_SOFTWARE_KEYWORDS,
} from './classification.js';

test('classifies an obvious software TOR as is_software: true', () => {
    const { is_software, classification_confidence } = classifyTor({
        project_name: 'จ้างพัฒนาระบบสารสนเทศและแอปพลิเคชันบนมือถือ',
    });
    assert.equal(is_software, true);
    assert.ok(classification_confidence > 0.5 && classification_confidence <= 0.95);
});

test('classifies an obvious construction TOR as is_software: false', () => {
    const { is_software, classification_confidence } = classifyTor({
        project_name: 'จ้างเหมาก่อสร้างปรับปรุงอาคารและงานโยธา',
    });
    assert.equal(is_software, false);
    assert.ok(classification_confidence > 0.5 && classification_confidence <= 0.95);
});

test('returns null when there is no keyword signal', () => {
    const result = classifyTor({ project_name: 'จ้างที่ปรึกษาโครงการ' });
    assert.deepEqual(result, { is_software: null, classification_confidence: null });
});

test('returns null when software and non-software signals tie', () => {
    const result = classifyTor({
        project_name: 'พัฒนาระบบ',
        extracted_data: { summary: 'งานก่อสร้าง' },
    });
    assert.equal(result.is_software, null);
    assert.equal(result.classification_confidence, null);
});

test('returns null for an empty document rather than throwing', () => {
    assert.deepEqual(classifyTor({}), { is_software: null, classification_confidence: null });
    assert.deepEqual(classifyTor(), { is_software: null, classification_confidence: null });
});

test('reads keywords from extracted_data scope_of_work / tech_stack', () => {
    const { is_software } = classifyTor({
        project_name: 'โครงการจัดหาผู้รับจ้าง',
        extracted_data: { scope_of_work: ['ออกแบบและพัฒนาเว็บไซต์'], tech_stack: ['React'] },
    });
    assert.equal(is_software, true);
});

test('confidence rises with more distinct software keyword matches', () => {
    const few = classifyTor({ project_name: 'พัฒนาระบบ' }).classification_confidence;
    const many = classifyTor({
        project_name: 'พัฒนาระบบสารสนเทศ เว็บไซต์ แอปพลิเคชัน และ dashboard บน cloud',
    }).classification_confidence;
    assert.ok(many > few);
});

test('applySoftwareFlag always sets both fields on a classifiable doc', () => {
    const out = applySoftwareFlag({ project_name: 'จ้างพัฒนาแอปพลิเคชัน', budget: 1 });
    assert.equal(out.is_software, true);
    assert.equal(typeof out.classification_confidence, 'number');
    assert.equal(out.budget, 1, 'other fields are preserved');
});

test('applySoftwareFlag sets keys (as null) even when undecidable', () => {
    const out = applySoftwareFlag({ project_name: 'จ้างที่ปรึกษา' });
    assert.ok('is_software' in out);
    assert.ok('classification_confidence' in out);
    assert.equal(out.is_software, null);
    assert.equal(out.classification_confidence, null);
});

test('applySoftwareFlag preserves a manual override and does not re-classify', () => {
    const out = applySoftwareFlag({
        project_name: 'จ้างเหมาก่อสร้างอาคาร',
        is_software: true,
    });
    assert.equal(out.is_software, true, 'existing value kept even though text looks non-software');
    assert.equal(out.classification_confidence, null);
});

test('keyword list is non-empty and lowercase-safe', () => {
    assert.ok(DEFAULT_SOFTWARE_KEYWORDS.length > 0);
    const upper = classifyTor({ project_name: 'DEVELOP a new mobile APP and WEBSITE' });
    assert.equal(upper.is_software, true);
});
