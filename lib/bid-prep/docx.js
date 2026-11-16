import { AI_DRAFT_NOTICE, NO_EGP_SUBMISSION_NOTICE, NO_EGP_SUBMISSION_NOTICE_TH } from './notices.js';
import { exportParagraph } from './text.js';

function dosStamp(date) {
    const when = date || new Date('2026-11-12T00:00:00Z');
    return {
        time: (when.getUTCHours() << 11) | (when.getUTCMinutes() << 5) | Math.floor(when.getUTCSeconds() / 2),
        date: ((when.getUTCFullYear() - 1980) << 9) | ((when.getUTCMonth() + 1) << 5) | when.getUTCDate(),
    };
}

function crc32(buffer) {
    let crc = ~0;
    for (const byte of buffer) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return ~crc >>> 0;
}

/** Stored-method ZIP. The archive contains only the four DOCX parts, no macros. */
export function zipStore(files) {
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const file of files) {
        const name = Buffer.from(file.name);
        const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
        const crc = crc32(data);
        const stamp = dosStamp();
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(stamp.time, 10);
        local.writeUInt16LE(stamp.date, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(name.length, 26);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(stamp.time, 12);
        central.writeUInt16LE(stamp.date, 14);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(data.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt32LE(offset, 42);
        locals.push(Buffer.concat([local, name, data]));
        centrals.push(Buffer.concat([central, name]));
        offset += 30 + name.length + data.length;
    }
    const directory = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, directory, end]);
}

function run(text, highlight = false) {
    return `<w:r>${highlight ? '<w:rPr><w:highlight w:val="yellow"/><w:color w:val="9C0006"/><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
}

function paragraph(value, style = '') {
    const text = exportParagraph(value);
    const lines = text.split(/\r?\n/);
    const runs = lines.map(line => line.split(/(\[to fill in(?:\s*:[^\]]*)?\])/gi)
        .filter(Boolean).map(part => run(part, /^\[to fill in/i.test(part))).join('')).join('<w:r><w:br/></w:r>');
    return `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${runs || run('')}</w:p>`;
}

export function safeDocxFilename(projectId) {
    const safe = String(projectId || 'draft').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64) || 'draft';
    return `bid-draft-${safe}.docx`;
}

function checklistTable(items) {
    const widths = [3500, 1100, 3300, 1126];
    const cell = (text, i, header) => `<w:tc><w:tcPr><w:tcW w:w="${widths[i]}" w:type="dxa"/><w:vAlign w:val="center"/>${header ? '<w:shd w:fill="E8EDF2"/>' : ''}</w:tcPr>${paragraph(text, header ? 'TableHeader' : 'TableText')}</w:tc>`;
    const row = (values, header = false) => `<w:tr>${header ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${values.map((value, i) => cell(value, i, header)).join('')}</w:tr>`;
    const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(edge => `<w:${edge} w:val="single" w:sz="4" w:color="D9D9D9"/>`).join('');
    const rows = items.length ? items : [{ requirement: '[to fill in: qualification checklist]', status: 'manual', reason: 'No extracted qualifications available. Review the TOR.', evidencePages: [] }];
    return `<w:tbl><w:tblPr><w:tblW w:w="9026" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${borders}</w:tblBorders><w:tblCellMar><w:top w:w="100" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map(width => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${row(['ข้อกำหนด', 'สถานะ', 'เหตุผล', 'หน้าอ้างอิง'], true)}${rows.map(item => row([item.requirement, item.status, item.reason, item.evidencePages?.length ? item.evidencePages.join(', ') : '[to fill in: source page]'])).join('')}</w:tbl>`;
}

/** Plain-text-only OOXML: no field codes, external relationships, HTML or macros. */
export function buildDraftDocx({ title, projectId, sections, createdAt, updatedAt, checklist = { items: [] }, exportedAt = new Date() }) {
    const created = new Date(createdAt || Date.now()).toISOString();
    const updated = new Date(updatedAt || created).toISOString();
    const exported = new Date(exportedAt).toISOString();
    let content = paragraph(title || 'Proposal draft', 'Title')
        + paragraph(`Project: ${projectId || ''}`)
        + paragraph(`Created: ${created}\nLast edited: ${updated}\nExported: ${exported}`)
        + paragraph(AI_DRAFT_NOTICE, 'Notice')
        + paragraph(NO_EGP_SUBMISSION_NOTICE, 'Notice')
        + paragraph(NO_EGP_SUBMISSION_NOTICE_TH, 'Notice')
        + paragraph('รายการตรวจสอบคุณสมบัติ', 'Heading1')
        + paragraph('Checklist results require human review. manual does not mean pass. Missing source pages must be checked against the TOR.');
    content += checklistTable(checklist.items || []);
    if (checklist.truncated) content += paragraph('Warning: checklist is truncated. Review all remaining TOR requirements.', 'Notice');
    if (checklist.missingProfileFields?.length) content += paragraph(`Missing company fields: ${checklist.missingProfileFields.join(', ')}`);
    content += paragraph('ร่างข้อเสนอ', 'Heading1');
    for (const section of sections || []) {
        content += paragraph(section.heading || 'Section', 'Heading2') + paragraph(section.body || '');
        const sources = Array.isArray(section.sources) ? section.sources.filter(Boolean) : [];
        content += paragraph(`Sources: ${sources.length ? sources.join(', ') : '[to fill in: source]'}`, 'Source');
    }
    const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${content}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/></w:sectPr></w:body></w:document>`;
    const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
    const wordRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
    const style = (id, size, bold = false, extra = '') => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${id}"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="${id.startsWith('Heading') ? 220 : 0}" w:after="100"/>${id.startsWith('Heading') ? '<w:keepNext/>' : ''}</w:pPr><w:rPr><w:color w:val="000000"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/>${bold ? '<w:b/><w:bCs/>' : ''}${extra}</w:rPr></w:style>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma" w:cs="Tahoma" w:eastAsia="Tahoma"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="th-TH" w:bidi="th-TH"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${style('Title', 36, true)}${style('Heading1', 28, true)}${style('Heading2', 24, true)}${style('Notice', 20, true)}${style('Source', 18)}${style('TableText', 20)}${style('TableHeader', 20, true)}</w:styles>`;
    return zipStore([
        { name: '[Content_Types].xml', data: types }, { name: '_rels/.rels', data: rels },
        { name: 'word/document.xml', data: document }, { name: 'word/_rels/document.xml.rels', data: wordRels },
        { name: 'word/styles.xml', data: styles },
    ]);
}
