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

function paragraph(text) {
    return `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

export function safeDocxFilename(projectId) {
    const safe = String(projectId || 'draft').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64) || 'draft';
    return `bid-draft-${safe}.docx`;
}

/**
 * One DOCX built from plain text. Callers pass already-owned draft fields.
 * The file states that it is a draft and that the seller submits to e-GP.
 */
export function buildDraftDocx({ title, projectId, sections, createdAt }) {
    const when = createdAt instanceof Date ? createdAt.toISOString() : new Date(createdAt || Date.now()).toISOString();
    const lines = [
        exportParagraph(title || 'Proposal draft'),
        exportParagraph(`Project: ${projectId || ''}`),
        exportParagraph(`Created: ${when}`),
        exportParagraph(AI_DRAFT_NOTICE),
        exportParagraph(NO_EGP_SUBMISSION_NOTICE),
        exportParagraph(NO_EGP_SUBMISSION_NOTICE_TH),
    ];
    for (const section of sections || []) {
        lines.push(exportParagraph(section.heading || 'Section'));
        lines.push(exportParagraph(section.body || ''));
        const sources = Array.isArray(section.sources) ? section.sources.filter(Boolean) : [];
        if (sources.length) lines.push(exportParagraph(`Sources: ${sources.join(', ')}`));
    }
    const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${lines.map(paragraph).join('')}</w:body></w:document>`;
    const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
    const wordRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
    return zipStore([
        { name: '[Content_Types].xml', data: types },
        { name: '_rels/.rels', data: rels },
        { name: 'word/document.xml', data: document },
        { name: 'word/_rels/document.xml.rels', data: wordRels },
    ]);
}
