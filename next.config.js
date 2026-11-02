/** @type {import("next").NextConfig} */

// Baseline hardening headers flagged by the OWASP ZAP baseline scan.
// Not set on purpose: a Content-Security-Policy (a partial policy such as
// frame-ancestors alone makes ZAP raise several CSP-quality alerts, and a full
// one needs nonces for Next.js inline scripts; X-Frame-Options already blocks
// clickjacking) and COEP/COOP/CORP (they can break the Google OAuth redirect
// and third-party images).
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
