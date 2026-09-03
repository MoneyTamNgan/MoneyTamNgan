import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import yauzl from 'yauzl';

const DEFAULT_MAX_ENTRIES = 200;
const DEFAULT_MAX_PDF_BYTES = 100 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const DEFAULT_MAX_COMPRESSION_RATIO = 200;

function positiveInteger(value, fallback) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function configuredLimits(options = {}) {
    return {
        maxEntries: positiveInteger(
            options.maxEntries ?? process.env.TOR_ZIP_MAX_ENTRIES,
            DEFAULT_MAX_ENTRIES
        ),
        maxPdfBytes: positiveInteger(
            options.maxPdfBytes
                ?? Number(process.env.TOR_ZIP_MAX_PDF_MB) * 1024 * 1024,
            DEFAULT_MAX_PDF_BYTES
        ),
        maxTotalBytes: positiveInteger(
            options.maxTotalBytes
                ?? Number(process.env.TOR_ZIP_MAX_EXTRACTED_MB) * 1024 * 1024,
            DEFAULT_MAX_TOTAL_BYTES
        ),
        maxCompressionRatio: positiveInteger(
            options.maxCompressionRatio ?? process.env.TOR_ZIP_MAX_COMPRESSION_RATIO,
            DEFAULT_MAX_COMPRESSION_RATIO
        ),
    };
}

function sanitizeFilename(value, fallback) {
    const basename = path.posix.basename(String(value || '').replaceAll('\\', '/'));
    const sanitized = basename
        .normalize('NFKC')
        .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '_')
        .replace(/^\.+/, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180);
    return sanitized || fallback;
}

function isSymlink(entry) {
    const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
    return (unixMode & 0o170000) === 0o120000;
}

async function hasPdfSignature(filePath) {
    const handle = await open(filePath, 'r');
    const header = Buffer.alloc(5);
    try {
        const { bytesRead } = await handle.read(header, 0, header.length, 0);
        return bytesRead === header.length && header.toString() === '%PDF-';
    } finally {
        await handle.close();
    }
}

function openZip(zipPath) {
    return new Promise((resolve, reject) => {
        yauzl.open(zipPath, {
            lazyEntries: true,
            autoClose: true,
            decodeStrings: true,
            validateEntrySizes: true,
        }, (error, zipFile) => error ? reject(error) : resolve(zipFile));
    });
}

function openEntryStream(zipFile, entry) {
    return new Promise((resolve, reject) => {
        zipFile.openReadStream(entry, (error, stream) => error ? reject(error) : resolve(stream));
    });
}

function primaryPdfScore(pdf) {
    const name = pdf.entryName.toLowerCase();
    let score = 0;
    if (/ร่างเอกสารประกวดราคา|e-?bidding|เอกสารประกวดราคา/.test(name)) score += 120;
    if (/ขอบเขตของงาน|terms? of reference|(?:^|[^a-z])tor(?:[^a-z]|$)/.test(name)) score += 100;
    if (/รายละเอียดคุณลักษณะ|specification|คุณลักษณะเฉพาะ/.test(name)) score += 60;
    if (/ราคากลาง|ประกาศ|แบบฟอร์ม|ภาคผนวก/.test(name)) score -= 20;
    return score + Math.min(pdf.size / (1024 * 1024), 20);
}

export function selectPrimaryPdf(pdfs) {
    if (!Array.isArray(pdfs) || pdfs.length === 0) return null;
    return [...pdfs].sort((a, b) => primaryPdfScore(b) - primaryPdfScore(a))[0];
}

/**
 * Extract PDF entries from a ZIP without trusting archive paths. Files are
 * flattened into a dedicated directory and bounded by entry, size, and
 * compression-ratio limits before any data is expanded.
 */
export async function extractPdfsFromZip(zipPath, options = {}) {
    const absoluteZipPath = path.resolve(zipPath);
    const outputDir = path.resolve(/* turbopackIgnore: true */
        options.outputDir || path.join(path.dirname(absoluteZipPath), 'extracted')
    );
    const limits = configuredLimits(options);
    await mkdir(outputDir, { recursive: true });

    const zipFile = await openZip(absoluteZipPath);
    const extracted = [];
    const rejected = [];
    let entryCount = 0;
    let totalBytes = 0;
    let settled = false;

    return new Promise((resolve, reject) => {
        const fail = async error => {
            if (settled) return;
            settled = true;
            zipFile.close();
            await Promise.all(extracted.map(file => unlink(file.absolutePath).catch(() => {})));
            reject(error);
        };

        zipFile.on('error', fail);
        zipFile.on('entry', async entry => {
            try {
                entryCount += 1;
                if (entryCount > limits.maxEntries) {
                    throw new Error(`ZIP contains more than ${limits.maxEntries} entries`);
                }

                const entryName = String(entry.fileName || '');
                const isDirectory = /\/$/.test(entryName);
                if (isDirectory || !/\.pdf$/i.test(entryName)) {
                    zipFile.readEntry();
                    return;
                }
                if (isSymlink(entry)) {
                    rejected.push(`${entryName}: symbolic links are not allowed`);
                    zipFile.readEntry();
                    return;
                }
                if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
                    rejected.push(`${entryName}: encrypted entries are not supported`);
                    zipFile.readEntry();
                    return;
                }
                if (entry.uncompressedSize <= 0 || entry.uncompressedSize > limits.maxPdfBytes) {
                    rejected.push(`${entryName}: PDF exceeds the per-file extraction limit`);
                    zipFile.readEntry();
                    return;
                }
                if (totalBytes + entry.uncompressedSize > limits.maxTotalBytes) {
                    throw new Error('ZIP exceeds the total PDF extraction limit');
                }
                const ratio = entry.uncompressedSize / Math.max(entry.compressedSize, 1);
                if (ratio > limits.maxCompressionRatio) {
                    rejected.push(`${entryName}: suspicious compression ratio`);
                    zipFile.readEntry();
                    return;
                }

                const filename = sanitizeFilename(
                    entryName,
                    `document-${String(entryCount).padStart(3, '0')}.pdf`
                );
                const finalPath = path.join(
                    outputDir,
                    `${String(entryCount).padStart(3, '0')}-${filename}`
                );
                const temporaryPath = `${finalPath}.part-${process.pid}-${randomUUID()}`;

                try {
                    const existing = await stat(finalPath);
                    if (existing.isFile() && existing.size === entry.uncompressedSize
                        && await hasPdfSignature(finalPath)) {
                        extracted.push({
                            entryName,
                            filename: path.basename(finalPath),
                            absolutePath: finalPath,
                            size: existing.size,
                            reused: true,
                        });
                        totalBytes += existing.size;
                        zipFile.readEntry();
                        return;
                    }
                } catch (error) {
                    if (error.code !== 'ENOENT') throw error;
                }

                let writtenBytes = 0;
                const limiter = new Transform({
                    transform(chunk, encoding, callback) {
                        writtenBytes += chunk.length;
                        if (writtenBytes > entry.uncompressedSize
                            || writtenBytes > limits.maxPdfBytes) {
                            callback(new Error(`Expanded PDF exceeded its declared size: ${entryName}`));
                            return;
                        }
                        callback(null, chunk);
                    },
                });
                const stream = await openEntryStream(zipFile, entry);
                try {
                    await pipeline(stream, limiter, createWriteStream(temporaryPath, { flags: 'wx' }));
                    if (writtenBytes !== entry.uncompressedSize) {
                        throw new Error(`Expanded PDF size did not match ZIP metadata: ${entryName}`);
                    }
                    if (!await hasPdfSignature(temporaryPath)) {
                        throw new Error(`ZIP entry does not have a PDF signature: ${entryName}`);
                    }
                    await rename(temporaryPath, finalPath);
                } catch (error) {
                    await unlink(temporaryPath).catch(() => {});
                    rejected.push(`${entryName}: ${error.message}`);
                    zipFile.readEntry();
                    return;
                }

                extracted.push({
                    entryName,
                    filename: path.basename(finalPath),
                    absolutePath: finalPath,
                    size: writtenBytes,
                    reused: false,
                });
                totalBytes += writtenBytes;
                zipFile.readEntry();
            } catch (error) {
                await fail(error);
            }
        });

        zipFile.on('end', () => {
            if (settled) return;
            settled = true;
            const primary = selectPrimaryPdf(extracted);
            if (!primary) {
                reject(new Error(
                    `ZIP contained no valid PDF files${rejected.length ? ` (${rejected.join('; ')})` : ''}`
                ));
                return;
            }
            resolve({
                archivePath: absoluteZipPath,
                outputDir,
                pdfs: extracted,
                primary,
                rejected,
                entryCount,
                totalBytes,
            });
        });

        zipFile.readEntry();
    });
}

/** Quick signature check used when deciding whether a downloaded file is ZIP. */
export async function hasZipSignature(filePath) {
    const stream = createReadStream(filePath, { start: 0, end: 3 });
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const header = Buffer.concat(chunks);
    return header.length === 4 && header[0] === 0x50 && header[1] === 0x4b
        && [[0x03, 0x04], [0x05, 0x06], [0x07, 0x08]]
            .some(([a, b]) => header[2] === a && header[3] === b);
}
