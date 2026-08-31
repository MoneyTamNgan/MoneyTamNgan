import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export function absoluteLocalPath(storedPath) {
    return path.isAbsolute(storedPath) ? storedPath : path.resolve(process.cwd(), storedPath);
}
export async function hashFile(filePath) {
    const absolutePath = absoluteLocalPath(filePath);
    const hash = createHash('sha256');
    const stream = createReadStream(absolutePath);
    for await (const chunk of stream) hash.update(chunk);
    const fileStat = await stat(absolutePath);
    return { sha256: hash.digest('hex'), size: fileStat.size, absolutePath };
}

/**
 * Persist an already validated local document. Local mode keeps the current
 * file; GCS mode uploads it under a deterministic hash-based object name.
 */
export async function persistDocument({ projectId, fiscalYear, localPath, mimeType }) {
    const hashed = await hashFile(localPath);
    const backend = (process.env.TOR_STORAGE_BACKEND || 'local').toLowerCase();

    if (backend === 'local') {
        return { ...hashed, localPath, gcsUri: null, backend };
    }
    if (backend !== 'gcs') throw new Error(`Unsupported TOR_STORAGE_BACKEND: ${backend}`);

    const bucketName = process.env.TOR_GCS_BUCKET;
    if (!bucketName) throw new Error('TOR_GCS_BUCKET is required when TOR_STORAGE_BACKEND=gcs');

    const { Storage } = await import('@google-cloud/storage');
    const storage = new Storage({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
    const extension = path.extname(hashed.absolutePath).toLowerCase() || '.bin';
    const objectName = [
        String(fiscalYear || 'unknown'),
        String(projectId),
        `${hashed.sha256}${extension}`,
    ].join('/');
    const file = storage.bucket(bucketName).file(objectName);
    const [exists] = await file.exists();

    if (!exists) {
        await storage.bucket(bucketName).upload(hashed.absolutePath, {
            destination: objectName,
            resumable: hashed.size > 5 * 1024 * 1024,
            metadata: {
                contentType: mimeType || 'application/octet-stream',
                metadata: { projectId: String(projectId), sha256: hashed.sha256 },
            },
        });
    }

    return {
        ...hashed,
        localPath,
        gcsUri: `gs://${bucketName}/${objectName}`,
        backend,
    };
}

export async function fileAsBase64(localPath, maxBytes = 20 * 1024 * 1024) {
    const absolutePath = absoluteLocalPath(localPath);
    const fileStat = await stat(absolutePath);
    if (fileStat.size > maxBytes) {
        throw new Error('Local PDF is too large for inline Vertex input; configure GCS storage');
    }
    return (await readFile(absolutePath)).toString('base64');
}
