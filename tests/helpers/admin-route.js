import { signSession } from '@/lib/auth';

// Domain tests exercise their real route guard with a scoped admin credential.
// Negative permission/origin cases live in tests/security/.
export const asAdmin = handler => async (request, context) => {
    const headers = new Headers(request?.headers);
    headers.set('Authorization', `Bearer ${await signSession({ sub: 'fixture-admin', role: 'admin' })}`);
    headers.set('Origin', 'http://localhost:3000');
    return handler(request ? new Request(request, { headers }) : new Request('http://localhost:3000/api/fixture', { method: 'POST', headers }), context);
};
