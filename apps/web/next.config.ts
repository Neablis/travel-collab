import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@tc/contracts", "@tc/domain"],
};

export default nextConfig;
