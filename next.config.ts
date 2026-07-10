import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
  serverExternalPackages: ['googleapis', 'sharp', 'puppeteer'],
};

export default nextConfig;
