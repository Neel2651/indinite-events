import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@indinite/core", "@indinite/db"],
  serverExternalPackages: ["mongoose", "bullmq", "ioredis"],
  poweredByHeader: false,
};

export default config;
