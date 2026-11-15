import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  images: { unoptimized: true },
  // Selling runs from the home search bar now, and deals are applied to search results automatically.
  async redirects() {
    return [
      { source: "/sell", destination: "/?mode=sell", permanent: false },
      { source: "/deals", destination: "/", permanent: false },
    ];
  },
};

export default nextConfig;
