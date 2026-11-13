import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The screens were renamed (leads -> prospects, work orders -> jobs ...). Old links and
  // bookmarks keep working.
  async redirects() {
    const moved: [from: string, to: string][] = [
      ["leads", "prospects"],
      ["accounts", "customers"],
      ["contacts", "people"],
      ["opportunities", "deals"],
      ["cases", "support-requests"],
      ["work-orders", "jobs"],
      ["my-bookings", "my-visits"],
      ["price-lists", "pricing"],
      ["resources", "team"],
    ];
    return moved.map(([from, to]) => ({
      source: `/app/${from}/:path*`,
      destination: `/app/${to}/:path*`,
      permanent: true,
    }));
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
