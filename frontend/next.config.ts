import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    remotePatterns: [
      { protocol: "http", hostname: "localhost", port: "8000", pathname: "/api/**" },
      { protocol: "https", hostname: "localhost", port: "8000", pathname: "/api/**" },
      { protocol: "https", hostname: "api.ltkdf.org", pathname: "/api/**" },
    ],
  },
};

export default withNextIntl(nextConfig);
