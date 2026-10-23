import { timingSafeEqual } from 'node:crypto';

/** True when the request carries the PIPELINE_ADMIN_TOKEN bearer token. */
export function isPipelineAuthorized(request) {
    const configured = process.env.PIPELINE_ADMIN_TOKEN || '';
    const supplied = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] || '';
    const expectedBytes = Buffer.from(configured);
    const suppliedBytes = Buffer.from(supplied);

    return (
        configured.length >= 32 &&
        expectedBytes.length === suppliedBytes.length &&
        timingSafeEqual(expectedBytes, suppliedBytes)
    );
}
