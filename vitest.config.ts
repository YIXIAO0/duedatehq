import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest config for unit tests on pure-logic modules. Integration / DB
 * tests are intentionally out of scope here — they belong on CI with a
 * test database. This config keeps `pnpm test` fast and offline-safe.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // `server-only` is Next.js's bundler-time guard that throws when
      // imported into a client component. In Node-side tests it has no
      // job to do — alias to an empty module so service files that
      // declare `import "server-only"` can still be unit-tested.
      "server-only": path.resolve(__dirname, "./test-shims/server-only.ts"),
    },
  },
});
