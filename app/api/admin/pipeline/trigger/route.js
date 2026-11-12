import { NextResponse, after } from 'next/server';
import { withRouteSecurity } from '@/lib/route-security';
import { requestPrincipal } from '@/lib/request-authorization';
import { pipelineAuditContext, logPipelineAudit } from '@/lib/admin-pipeline-audit';
import { pipelineStore } from '@/lib/admin-pipeline-store';
import connectDB from '@/lib/db';
import { triggerPipeline } from '@/lib/services/pipeline-runner';

export const runtime = 'nodejs';
export const maxDuration = 300;

async function handlePOST(request) {
    const actor = pipelineAuditContext(request, await requestPrincipal(request));
    const invalid = async message => {
        await connectDB();
        await pipelineStore.audit({ ...actor, outcome: 'invalid_request', http_status: 400 });
        return NextResponse.json({ status: 'failed', error: { code: 'INVALID_PIPELINE_REQUEST', message } }, { status: 400 });
    };
    try {
        const reader = request.body?.getReader();
        const chunks = []; let size = 0;
        if (reader) while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 8192) { await reader.cancel(); return await invalid('Request body must not exceed 8 KiB'); }
            chunks.push(Buffer.from(value));
        }
        const text = Buffer.concat(chunks).toString('utf8');
        let body;
        try { body = text.trim() ? JSON.parse(text) : {}; }
        catch { return await invalid('Request body must be valid JSON'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return await invalid('Request body must be an object');
        const { limit = 5, depts, projectIds, allowBrowser = true, sync = false, force = false } = body;
        if (!Number.isInteger(limit) || limit < 1 || limit > 50) return await invalid('limit must be an integer between 1 and 50');
        if (depts !== undefined && (!Array.isArray(depts) || depts.length > 100 || depts.some(id => typeof id !== 'string' || !/^\d{4}$/.test(id)))) return await invalid('depts must contain at most 100 four-digit department IDs');
        if (projectIds !== undefined && (!Array.isArray(projectIds) || projectIds.length > limit || projectIds.some(id => typeof id !== 'string' || !/^\d{11}$/.test(id)))) return await invalid('projectIds must contain at most limit eleven-digit project IDs');
        if (typeof allowBrowser !== 'boolean' || typeof force !== 'boolean' || sync !== false) return await invalid('allowBrowser and force must be booleans; sync must be false (this endpoint is always asynchronous)');
        if ('tenders' in body) return await invalid('Raw tender injection is not supported; use projectIds');
        await connectDB();
        const run = await triggerPipeline({ limit, depts, projectIds, allowBrowser, force }, actor, after);
        return NextResponse.json({ status: 'accepted', jobId: run.id, runId: run.id, startedAt: run.startedAt,
            message: 'Data pipeline run started in background', statusUrl: '/api/admin/pipeline/status', run }, { status: 202 });
    } catch (error) {
        if (error.code === 'PIPELINE_ALREADY_RUNNING') return NextResponse.json({ status: 'conflict',
            error: { code: error.code, message: 'A data pipeline run is already in progress' }, currentRun: error.currentRun }, { status: 409 });
        logPipelineAudit({ ...actor, outcome: 'start_failed', http_status: 503 });
        return NextResponse.json({ status: 'failed', error: { code: 'PIPELINE_TRIGGER_FAILED', message: 'Pipeline control is unavailable; no new run was started' } }, { status: 503 });
    }
}

export const POST = withRouteSecurity(handlePOST, '/api/admin/pipeline/trigger', 'POST');
