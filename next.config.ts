import type { NextConfig } from "next";

// Next dev (Turbopack/HMR) evaluates code via eval(); production never does, so
// 'unsafe-eval' is dev-only. 'unsafe-inline' in script-src is required because
// Next.js injects inline bootstrap/hydration scripts (a nonce-based CSP would need
// per-request middleware, which a fully static export cannot use). The app renders
// no user-supplied HTML, so there is no injection surface for it to protect against.
const isDev = process.env.NODE_ENV !== "production";

// blob: is required for the WebGL texture pipeline three.js uses for the marbles.
const csp = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "worker-src 'self' blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig: NextConfig = {
  devIndicators: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // Never cache the entry HTML so a new deploy is picked up immediately;
        // the hashed /_next/static assets it references stay immutably cached.
        source: "/",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
