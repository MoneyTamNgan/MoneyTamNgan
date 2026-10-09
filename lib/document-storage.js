import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, rm, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import mongoose from 'mongoose';

export const GRIDFS_BUCKET = 'documents';

export function absoluteLocalPath(storedPath) {
    return path.isAbsolute(storedPath)
        ? storedPath
        : path.resolve(/* turbopackIgnore: true */ process.cwd(), storedPath);
}
export async function hashFile(filePath) {
    const absolutePath = absoluteLocalPath(filePath);
    const hash = createHash('sha256');
    const stream = createReadStream(absolutePath);
    for await (const chunk of stream) hash.update(chunk);
    const fileStat = await stat(absolutePath);
    return { sha256: hash.digest('hex'), size: fileStat.size, absolutePath };
}

/** Remove transient source files after OCR text has been committed to MongoDB. */
export async function removeTransientDocuments(result, textResult = null) {
    const files = new Set([
        result?.pdf_path,
        result?.archive_path,
        ...(result?.extracted_pdfs || []).map(file => file.path),
    ].filter(Boolean).map(absoluteLocalPath));
    await Promise.all([...files].map(file => unlink(file).catch(error => {
        if (error.code !== 'ENOENT') throw error;
    })));
    if (textResult?.artifactPath) {
        await rm(path.dirname(absoluteLocalPath(textResult.artifactPath)), {
            recursive: true,
            force: true,
        });
    }
}

/**
 * Store a file in MongoDB GridFS, once per (project, sha256). Suited to small
 * files such as invitations; the free Atlas tier cannot hold every TOR.
 */
async function persistToGridFs({ projectId, fiscalYear, hashed, mimeType, db }) {
    const bucket = new mongoose.mongo.GridFSBucket(db, { bucketName: GRIDFS_BUCKET });
    const existing = await db.collection(`${GRIDFS_BUCKET}.files`).findOne({
        'metadata.projectId': String(projectId),
        'metadata.sha256': hashed.sha256,
    }, { projection: { _id: 1 } });
    if (existing) return existing._id;

    const extension = path.extname(hashed.absolutePath).toLowerCase() || '.bin';
    const upload = bucket.openUploadStream(
        [String(fiscalYear || 'unknown'), String(projectId), `${hashed.sha256}${extension}`].join('/'),
        { metadata: { projectId: String(projectId), sha256: hashed.sha256,
            contentType: mimeType || 'application/octet-stream' } }
    );
    await pipeline(createReadStream(hashed.absolutePath), upload);
    return upload.id;
}

/** Stream a GridFS-stored document, e.g. to an HTTP response. */
export function openGridFsDocument(id, db = mongoose.connection.db) {
    const bucket = new mongoose.mongo.GridFSBucket(db, { bucketName: GRIDFS_BUCKET });
    return bucket.openDownloadStream(new mongoose.Types.ObjectId(String(id)));
}

/**
 * Persist an already validated local document. Local mode keeps the current
 * file; GCS mode uploads it under a deterministic hash-based object name;
 * GridFS mode stores it in MongoDB. `backend` overrides TOR_STORAGE_BACKEND.
 */
export async function persistDocument({
    projectId, fiscalYear, localPath, mimeType, backend: requestedBackend, db,
}) {
    const hashed = await hashFile(localPath);
    const backend = (requestedBackend || process.env.TOR_STORAGE_BACKEND || 'local').toLowerCase();

    if (backend === 'local') {
        return { ...hashed, localPath, gcsUri: null, backend };
    }
    if (backend === 'gridfs') {
        const gridfsId = await persistToGridFs({
            projectId, fiscalYear, hashed, mimeType, db: db || mongoose.connection.db,
        });
        return { ...hashed, localPath, gcsUri: null, gridfsId, backend };
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
