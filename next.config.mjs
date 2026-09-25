/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  serverExternalPackages: ["postgres", "bcryptjs"],
  poweredByHeader: false,
};
export default nextConfig;
