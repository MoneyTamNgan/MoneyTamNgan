import dns from 'node:dns';
import net from 'node:net';

function stripBrackets(hostname) {
    return String(hostname || '').trim().toLowerCase().replace(/\.$/, '').replace(/^\[(.*)\]$/, '$1');
}

function hexPairToIpv4(highHex, lowHex) {
    const high = Number.parseInt(highHex, 16);
    const low = Number.parseInt(lowHex, 16);
    return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
}

export function isPrivateIp(rawHostname) {
    const hostname = stripBrackets(rawHostname);
    const ipVersion = net.isIP(hostname);
    if (!ipVersion) return false;

    if (ipVersion === 4) {
        return /^0\./.test(hostname)
            || /^127\./.test(hostname)
            || /^10\./.test(hostname)
            || /^192\.168\./.test(hostname)
            || /^169\.254\./.test(hostname)
            || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
            || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(hostname)
            || /^(22[4-9]|23\d|24\d|25[0-5])\./.test(hostname);
    }

    // IPv4-mapped IPv6 addresses (dotted or hex-pair form)
    const dottedMapped = hostname.match(/^(?:::ffff:|0:0:0:0:0:ffff:)(\d+\.\d+\.\d+\.\d+)$/);
    if (dottedMapped) return isPrivateIp(dottedMapped[1]);
    const hexMapped = hostname.match(/^(?:::ffff:|0:0:0:0:0:ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMapped) return isPrivateIp(hexPairToIpv4(hexMapped[1], hexMapped[2]));

    return hostname === '::1'
        || hostname === '::'
        || hostname === '0:0:0:0:0:0:0:1'
        || hostname === '0:0:0:0:0:0:0:0'
        || /^f[cd][0-9a-f]{0,2}:/.test(hostname)
        || /^fe[89ab][0-9a-f]:/.test(hostname)
        || /^fec[0-9a-f]:/.test(hostname)
        || /^ff[0-9a-f]{2}:/.test(hostname)
        || /^64:ff9b:/.test(hostname);
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

    const host = stripBrackets(url.hostname);
    const isIp = net.isIP(host) !== 0;
    if (
        !host
        || host === 'localhost'
        || host.endsWith('.localhost')
        || host.endsWith('.local')
        || host.endsWith('.internal')
        || (!isIp && !host.includes('.'))
        || isPrivateIp(host)
    ) {
        throw new Error('Document URL cannot target a local or private address');
    }
    return url.href;
}

export async function resolveAndValidateRemoteDocumentUrl(
    value,
    lookupFn = (host) => dns.promises.lookup(host, { all: true, verbatim: true })
) {
    const href = validateRemoteDocumentUrl(value);
    const host = stripBrackets(new URL(href).hostname);
    if (net.isIP(host)) return href;

    let records;
    try {
        records = await lookupFn(host);
    } catch {
        throw new Error('Document URL cannot target a local or private address');
    }

    if (!Array.isArray(records) || records.length === 0) {
        throw new Error('Document URL cannot target a local or private address');
    }

    for (const record of records) {
        if (!record?.address || isPrivateIp(record.address)) {
            throw new Error('Document URL cannot target a local or private address');
        }
    }
    return href;
}
