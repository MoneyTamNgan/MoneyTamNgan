import { withRouteSecurity } from '@/lib/route-security';
import { passwordAuthHandler } from '@/lib/password-auth-handler';

export const runtime = 'nodejs';
export const POST = withRouteSecurity(passwordAuthHandler('login'), '/api/auth/login', 'POST');
