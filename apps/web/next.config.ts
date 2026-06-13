import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@atlas/contracts'],
  // The brand hero is a pre-optimized webp; skip runtime optimization so the
  // server never needs to write .next/cache/images (EACCES under USER node).
  images: { unoptimized: true },
};

export default nextConfig;
