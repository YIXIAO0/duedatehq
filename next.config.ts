import type { NextConfig } from "next";
import path from "node:path";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  // Cache Components (PPR successor) — lets us cache the seed deadline DB
  // aggressively while keeping user data dynamic.
  // https://nextjs.org/docs/app/getting-started/cache-components
  cacheComponents: true,

  // Externalize Neon driver so the Fluid Compute runtime uses the native
  // serverless package rather than bundling it.
  serverExternalPackages: ["@neondatabase/serverless"],

  // Pin the workspace root so Next.js doesn't infer a parent dir with a
  // stray lockfile as the monorepo root.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

// Workflow DevKit — enables the "use workflow" / "use step" directives
// used in src/lib/workflows/*. The wrapper injects the runtime endpoints
// at /.well-known/workflow/* and rewires the build for those code paths.
// https://useworkflow.dev
export default withWorkflow(nextConfig);
