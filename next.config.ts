import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
  poweredByHeader: false,
  distDir: process.env.NEXT_DIST_DIR || ".next",
  devIndicators: false,
  // the schema file is read at runtime to auto-migrate; make sure Vercel bundles it
  outputFileTracingIncludes: { "/api/**": ["./db/migrations/**"] },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
};

export default nextConfig;
