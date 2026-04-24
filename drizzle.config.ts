import type { Config } from "drizzle-kit";

// drizzle-kit doesn't auto-load .env.local. Run commands via dotenv-cli:
//   pnpm db:generate
//   pnpm db:push
//   pnpm db:studio
// See package.json scripts.

export default {
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
} satisfies Config;
