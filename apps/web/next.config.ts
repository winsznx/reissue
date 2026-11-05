import type { NextConfig } from "next";

const apiBase = process.env.API_BASE_URL ?? "http://localhost:4210";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  agentRules: false,
  devIndicators: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiBase}/:path*` }];
  },
};

export default nextConfig;
