/** @type {import('next').NextConfig} */
const nextConfig = {
  // The WebGL viewer tolerates the dev double-mount: dispose() releases everything and a late load() never settles.
  reactStrictMode: true,
  typescript: { ignoreBuildErrors: false },
};
export default nextConfig;
