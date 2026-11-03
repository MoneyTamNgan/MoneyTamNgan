export const CORS_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
export const CORS_HEADERS = ['Content-Type', 'Authorization'];
export const isMutation = method => !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());

export function allowedOrigins(env = process.env) {
    const values = [env.APP_ORIGIN, ...(env.CORS_ALLOWED_ORIGINS || '').split(',')].filter(Boolean);
    // Local-only default in both next dev and next start; deployments must set
    // their exact origin explicitly. Never infer trust from a Host header.
    if (!values.length || env.NODE_ENV !== 'production') values.push('http://localhost:3000', 'http://127.0.0.1:3000');
    return [...new Set(values.map(value => {
        const input = value.trim();
        const url = new URL(input);
        if (input.includes('*') || !['http:', 'https:'].includes(url.protocol) || url.username || url.password
            || url.pathname !== '/' || url.search || url.hash
            || (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
            throw new Error('APP_ORIGIN/CORS_ALLOWED_ORIGINS must contain exact HTTPS origins (HTTP loopback allowed), never wildcards');
        }
        return url.origin;
    }))];
}

export function contentSecurityPolicy({ nonce, development = process.env.NODE_ENV === 'development', upgrade = false } = {}) {
    return ["default-src 'self'", `script-src 'self'${nonce ? ` 'nonce-${nonce}' 'strict-dynamic'` : ''}${development ? " 'unsafe-eval'" : ''}`,
        // Existing React charts use style attributes; scripts never get unsafe-inline.
        "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: https://lh3.googleusercontent.com",
        "font-src 'self' data:", `connect-src 'self'${development ? ' ws://localhost:* ws://127.0.0.1:*' : ''}`,
        "object-src 'none'", "frame-src 'self'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
        ...(upgrade ? ['upgrade-insecure-requests'] : []),
    ].join('; ');
}

export function securityHeaders(csp = contentSecurityPolicy()) {
    return [
        { key: 'Content-Security-Policy', value: csp },
        { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    ];
}

export function originError(request, { machine = false } = {}) {
    const origin = request.headers.get('origin');
    let origins;
    try { origins = allowedOrigins(); } catch { return 'CORS origin configuration is invalid'; }
    if (origin && !origins.includes(origin)) return 'Origin is not allowed';
    if (request.method === 'OPTIONS' && request.headers.get('access-control-request-method')) {
        if (!origin || !CORS_METHODS.includes(request.headers.get('access-control-request-method').toUpperCase())) return 'Invalid preflight method or origin';
        const headers = (request.headers.get('access-control-request-headers') || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
        if (headers.some(x => !CORS_HEADERS.map(h => h.toLowerCase()).includes(x))) return 'Preflight header is not allowed';
    }
    if (isMutation(request.method) && !origin) {
        // An authenticated explicit bearer token is not an ambient browser cookie.
        if (!machine || ![null, 'none'].includes(request.headers.get('sec-fetch-site'))) return 'An allowed Origin is required for browser mutations';
    }
    return null;
}

export function applyCors(response, request) {
    const origin = request.headers.get('origin');
    const vary = new Set((response.headers.get('vary') || '').split(',').map(x => x.trim()).filter(Boolean));
    vary.add('Origin');
    response.headers.set('Vary', [...vary].join(', '));
    if (origin && allowedOrigins().includes(origin)) {
        response.headers.set('Access-Control-Allow-Origin', origin);
        response.headers.set('Access-Control-Allow-Credentials', 'true');
        response.headers.set('Access-Control-Allow-Methods', CORS_METHODS.join(', '));
        response.headers.set('Access-Control-Allow-Headers', CORS_HEADERS.join(', '));
    }
    return response;
}
