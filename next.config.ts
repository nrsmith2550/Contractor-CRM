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
    return [
      ...moved.map(([from, to]) => ({
        source: `/app/${from}/:path*`,
        destination: `/app/${to}/:path*`,
        permanent: true,
      })),
      // Pricing now lives on the home page.
      { source: "/pricing", destination: "/#pricing", permanent: true },
      // The two halves of the product were called Sales and Service before they became Deals and Jobs.
      { source: "/app/dashboards/sales", destination: "/app/dashboards/deals", permanent: true },
      { source: "/app/dashboards/service", destination: "/app/dashboards/jobs", permanent: true },
      { source: "/app/settings/service", destination: "/app/settings/jobs", permanent: true },
    ];
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
