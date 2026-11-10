import { withRouteSecurity } from '@/lib/route-security';
import { withOAuthLimit } from '@/lib/oauth-security';
import { startGoogleOAuth } from '@/lib/google-oauth-start';

export const GET = withRouteSecurity(withOAuthLimit(startGoogleOAuth, 'start'), '/api/auth/google/login', 'GET');
