/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  transpilePackages: ["@mezair/config", "@mezair/name-squatting", "@mezair/object-store", "@mezair/persistence", "@mezair/shared"]
};

export default nextConfig;
