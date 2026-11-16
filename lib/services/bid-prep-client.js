export class BidPrepRequestError extends Error {
    constructor(status, body) { super(body?.error?.message || 'Unable to complete request.'); this.status = status; this.code = body?.error?.code; }
}
export async function bidPrepRequest(path, { method = 'GET', body, signal } = {}) {
    const response = await fetch(path, { method, cache: 'no-store', signal,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new BidPrepRequestError(response.status, data);
    return data;
}
export async function downloadBidDraft(id, version) {
    const response = await fetch(`/api/bid-prep/drafts/${encodeURIComponent(id)}/export?version=${version}`, { method: 'POST' });
    if (!response.ok) throw new BidPrepRequestError(response.status, await response.json().catch(() => ({})));
    const blob = await response.blob();
    const suggested = response.headers.get('Content-Disposition')?.match(/filename="([A-Za-z0-9._-]+\.docx)"/)?.[1] || 'bid-draft.docx';
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = suggested; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
