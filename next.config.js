import { allowedOrigins, securityHeaders, CORS_METHODS, CORS_HEADERS } from './lib/security-policy.js';

/** @type {import('next').NextConfig} */
const nextConfig = {
    poweredByHeader: false,
    async headers() {
        const origins = allowedOrigins();
        return [{ source: '/:path*', headers: securityHeaders() }, ...origins.map(origin => ({
            source: '/api/:path*',
            has: [{ type: 'header', key: 'origin', value: origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }],
            headers: [
                { key: 'Access-Control-Allow-Origin', value: origin },
                { key: 'Access-Control-Allow-Credentials', value: 'true' },
                { key: 'Access-Control-Allow-Methods', value: CORS_METHODS.join(', ') },
                { key: 'Access-Control-Allow-Headers', value: CORS_HEADERS.join(', ') },
                { key: 'Vary', value: 'Origin' },
            ],
        }))];
    },
};

export default nextConfig;
