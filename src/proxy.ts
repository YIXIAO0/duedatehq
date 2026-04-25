// Next.js 16 renamed `middleware.ts` → `proxy.ts`. We still use Clerk's
// clerkMiddleware() under the hood — the filename is the only change.
// https://nextjs.org/docs/app/building-your-application/routing/proxy

import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/clients(.*)",
  "/deadlines(.*)",
  "/settings(.*)",
  "/api/trpc(.*)",
]);

// Public routes that never require auth (MCP is stub-only for now; V2 gates it)
const isPublicApiRoute = createRouteMatcher([
  "/api/cron/(.*)", // Vercel Cron hits this — protected by CRON_SECRET, not auth
  "/api/mcp(.*)",   // MCP stub — V2 will add API-key auth
  "/.well-known/workflow/(.*)", // Workflow DevKit runtime endpoints
]);

export default clerkMiddleware(async (auth, req) => {
  if (isPublicApiRoute(req)) return;
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals, Workflow DevKit internals, and static files
    "/((?!_next|\\.well-known/workflow|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
