/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // the WebGL viewer owns a canvas; avoid the dev double-mount
  typescript: { ignoreBuildErrors: false },
};
export default nextConfig;
