import { afterEach, describe, expect, it, vi } from 'vitest';
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { extractPdfsFromZip, resolveSafeArchiveMemberPath } from '@/lib/archive-extractor';

function crc32(buffer) {
    if (typeof zlib.crc32 === 'function') return zlib.crc32(buffer) >>> 0;
    let crc = 0xffffffff;
    for (let i = 0; i < buffer.length; i += 1) {
        crc ^= buffer[i];
        for (let bit = 0; bit < 8; bit += 1) {
            crc = (crc & 1) ? ((crc >>> 1) ^ 0xedb88320) : (crc >>> 1);
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Build a raw stored-mode ZIP buffer without normalizing entry names so tests
 * can craft real Zip Slip (../, absolute, drive-letter) and symlink fixtures.
 */
function buildRawZip(entries) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const entry of entries) {
        const nameBuf = Buffer.from(entry.name, 'utf8');
        const dataBuf = Buffer.isBuffer(entry.content)
            ? entry.content
            : Buffer.from(entry.content || '', 'utf8');
        const checksum = crc32(dataBuf);
        const mode = entry.mode ?? 0o100644;
        const externalAttr = ((mode & 0xffff) << 16) >>> 0;
        const flags = 0x0800; // UTF-8 filename flag

        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(20, 4);
        localHeader.writeUInt16LE(flags, 6);
        localHeader.writeUInt16LE(0, 8);
        localHeader.writeUInt32LE(checksum, 14);
        localHeader.writeUInt32LE(dataBuf.length, 18);
        localHeader.writeUInt32LE(dataBuf.length, 22);
        localHeader.writeUInt16LE(nameBuf.length, 26);

        localParts.push(localHeader, nameBuf, dataBuf);

        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(0x02014b50, 0);
        centralHeader.writeUInt16LE((3 << 8) | 20, 4); // Unix creator
        centralHeader.writeUInt16LE(20, 6);
        centralHeader.writeUInt16LE(flags, 8);
        centralHeader.writeUInt16LE(0, 10);
        centralHeader.writeUInt32LE(checksum, 16);
        centralHeader.writeUInt32LE(dataBuf.length, 20);
        centralHeader.writeUInt32LE(dataBuf.length, 24);
        centralHeader.writeUInt16LE(nameBuf.length, 28);
        centralHeader.writeUInt32LE(externalAttr, 38);
        centralHeader.writeUInt32LE(offset, 42);

        centralParts.push(centralHeader, nameBuf);
        offset += localHeader.length + nameBuf.length + dataBuf.length;
    }

    const centralDir = Buffer.concat(centralParts);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(centralDir.length, 12);
    eocd.writeUInt32LE(offset, 16);

    return Buffer.concat([...localParts, centralDir, eocd]);
}

describe('Zip Slip prevention (STRIDE TH-03 / ASVS V5.3.2)', () => {
    const tempDirs = [];

    afterEach(async () => {
        vi.restoreAllMocks();
        await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
    });

    it('rejects traversal, absolute, drive-letter, and null-byte paths in resolveSafeArchiveMemberPath', () => {
        const base = path.resolve('/tmp/scoped-extract-dir');
        for (const badPath of [
            '../../evil.txt',
            'nested/../../../evil.pdf',
            '..\\..\\evil.txt',
            '/etc/evil.pdf',
            '\\Windows\\evil.pdf',
            'C:\\evil.pdf',
            'D:/evil.pdf',
            'tor.pdf\0.exe',
            '',
            '.',
        ]) {
            expect(resolveSafeArchiveMemberPath(base, badPath).safe).toBe(false);
        }

        expect(resolveSafeArchiveMemberPath(base, 'เอกสาร/TOR.pdf').safe).toBe(true);
        expect(resolveSafeArchiveMemberPath(base, 'เอกสาร/').safe).toBe(true);
    });

    it('skips Zip Slip, absolute, drive-letter, and symlink entries while extracting valid PDFs', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'mtn-zip-slip-'));
        tempDirs.push(root);
        const nestedBase = path.join(root, 'a', 'b');
        const outputDir = path.join(nestedBase, 'extracted');
        const zipPath = path.join(nestedBase, 'weaponized.zip');

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const zipBytes = buildRawZip([
            { name: '../../evil.txt', content: 'pwned-outside-txt' },
            { name: '../../evil.pdf', content: '%PDF-1.7\npwned-outside-pdf' },
            { name: '/tmp/mtn-abs-evil.pdf', content: '%PDF-1.7\nabs-path' },
            { name: 'C:\\evil-drive.pdf', content: '%PDF-1.7\ndrive-path' },
            { name: 'symlink-tor.pdf', content: '/etc/passwd', mode: 0o120777 },
            { name: 'symlink-note.txt', content: '/etc/passwd', mode: 0o120777 },
            { name: 'เอกสาร/ร่างเอกสารประกวดราคา-TOR.pdf', content: '%PDF-1.7\nvalid tor content' },
        ]);
        await mkdir(nestedBase, { recursive: true });
        await writeFile(zipPath, zipBytes);

        const result = await extractPdfsFromZip(zipPath, { outputDir });

        expect(result.pdfs).toHaveLength(1);
        expect(result.primary.entryName).toBe('เอกสาร/ร่างเอกสารประกวดราคา-TOR.pdf');
        expect(result.primary.absolutePath.startsWith(outputDir + path.sep)).toBe(true);
        const extractedBytes = await readFile(result.primary.absolutePath, 'utf8');
        expect(extractedBytes).toBe('%PDF-1.7\nvalid tor content');

        expect(result.rejected).toHaveLength(6);
        expect(result.rejected.some(msg => msg.includes('../../evil.txt'))).toBe(true);
        expect(result.rejected.some(msg => msg.includes('../../evil.pdf'))).toBe(true);
        expect(result.rejected.some(msg => msg.includes('/tmp/mtn-abs-evil.pdf'))).toBe(true);
        expect(result.rejected.some(msg => msg.includes('C:\\evil-drive.pdf'))).toBe(true);
        expect(result.rejected.some(msg => msg.includes('symlink-tor.pdf'))).toBe(true);
        expect(result.rejected.some(msg => msg.includes('symlink-note.txt'))).toBe(true);
        expect(warnSpy).toHaveBeenCalledTimes(6);

        // Confirm nothing was written outside outputDir
        await expect(access(path.join(root, 'evil.txt'))).rejects.toThrow();
        await expect(access(path.join(root, 'evil.pdf'))).rejects.toThrow();
        await expect(access('/tmp/mtn-abs-evil.pdf')).rejects.toThrow();
        expect(await readdir(outputDir)).toEqual([result.primary.filename]);
    });

    it('rejects an archive with only escaping entries without writing outside outputDir', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'mtn-zip-only-bad-'));
        tempDirs.push(root);
        const workDir = path.join(root, 'sub', 'pkg');
        await mkdir(workDir, { recursive: true });
        const outputDir = path.join(workDir, 'extracted');
        const zipPath = path.join(workDir, 'only-bad.zip');

        vi.spyOn(console, 'warn').mockImplementation(() => {});
        await writeFile(zipPath, buildRawZip([
            { name: '../../evil.txt', content: 'pwned' },
            { name: '/etc/evil.pdf', content: '%PDF-1.7\nabs' },
        ]));

        await expect(extractPdfsFromZip(zipPath, { outputDir })).rejects.toThrow(/no valid PDF files/);
        await expect(access(path.join(root, 'evil.txt'))).rejects.toThrow();
        expect(await readdir(outputDir)).toEqual([]);
    });

    it('still extracts a normal archive normally', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'mtn-zip-normal-'));
        tempDirs.push(root);
        const outputDir = path.join(root, 'extracted');
        const zipPath = path.join(root, 'normal.zip');

        await writeFile(zipPath, buildRawZip([
            { name: 'เอกสาร/ประกาศเชิญชวน.pdf', content: '%PDF-1.7\nannouncement' },
            { name: 'เอกสาร/ขอบเขตของงาน-TOR.pdf', content: '%PDF-1.7\ntor document body' },
            { name: 'readme.txt', content: 'plain text note' },
        ]));

        const result = await extractPdfsFromZip(zipPath, { outputDir });
        expect(result.pdfs).toHaveLength(2);
        expect(result.rejected).toEqual([]);
        expect(result.primary.entryName).toBe('เอกสาร/ขอบเขตของงาน-TOR.pdf');
    });
});
