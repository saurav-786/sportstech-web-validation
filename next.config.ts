import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  typescript: {
    tsconfigPath: './tsconfig.dashboard.json',
  },
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
