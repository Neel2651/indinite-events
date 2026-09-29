import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@indinite/core", "@indinite/db", "@indinite/emails"],
  // @react-pdf/renderer (pass PDFs) runs as plain Node on the server, not through the bundler.
  serverExternalPackages: ["mongoose", "@react-pdf/renderer"],
  poweredByHeader: false,
  // Event image uploads (5 MB max, checked in addEventImage) go through server actions.
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Camera only for our own pages (the gate scanner); no mic/location.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default config;
