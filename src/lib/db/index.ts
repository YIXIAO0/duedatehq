/**
 * Drizzle DB client (lazy init — safe for build time when env vars absent).
 *
 * IMPORTANT: Do NOT wrap in a JavaScript Proxy. Per Vercel Storage guidance,
 * Proxy wrappers can break libraries that inspect the client shape.
 */

import "server-only";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>;

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Provision Neon via the Vercel Marketplace, then run `vercel env pull .env.local`.",
    );
  }
  const sql = neon(url);
  return drizzle(sql, { schema });
}

let _db: Db | null = null;

export function getDb(): Db {
  if (!_db) _db = createDb();
  return _db;
}

export { schema };
