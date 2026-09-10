import net from 'node:net';

function isPrivateIp(hostname) {
    if (!net.isIP(hostname)) return false;
    return hostname === '::1'
        || hostname.startsWith('fc')
        || hostname.startsWith('fd')
        || hostname.startsWith('fe80:')
        || /^127\./.test(hostname)
        || /^10\./.test(hostname)
        || /^192\.168\./.test(hostname)
        || /^169\.254\./.test(hostname)
        || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
}
export function validateRemoteDocumentUrl(value) {
    let url;
    try {
        url = new URL(value);
    } catch {
        throw new Error('Document URL is invalid');
    }

    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('Document URL must use HTTP or HTTPS');
    }
    if (url.username || url.password) throw new Error('Document URL cannot contain credentials');
    if (url.hostname === 'localhost' || url.hostname.endsWith('.local') || isPrivateIp(url.hostname)) {
        throw new Error('Document URL cannot target a local or private address');
    }
    return url.href;
}
