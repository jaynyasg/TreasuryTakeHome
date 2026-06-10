import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ship the committed COLA registry fixtures with the serverless function so
  // the cached-fallback path works on Vercel (see app/api/cola/[ttbid]).
  outputFileTracingIncludes: {
    "/api/cola/[ttbid]": ["./eval/fixtures/*.html"],
  },
};

export default nextConfig;
