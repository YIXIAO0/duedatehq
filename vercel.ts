// DueDateHQ — Vercel project configuration (vercel.ts replaces vercel.json)
// https://vercel.com/docs/project-configuration/vercel-ts

import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  framework: "nextjs",
  buildCommand: "pnpm build",
  installCommand: "pnpm install --frozen-lockfile",

  crons: [
    // Daily 06:00 UTC scan — generate + send per-deadline reminder emails
    // (30 / 14 / 3 / 1 days out). Stub today; logic lands in Round 7c.
    {
      path: "/api/cron/reminders",
      schedule: "0 6 * * *",
    },

    // Monday 12:00 UTC = 07:00 EST / 08:00 EDT — weekly "your week ahead"
    // digest. Idempotent per (user, ISO week), so safe if Vercel double-fires.
    {
      path: "/api/cron/weekly-digest",
      schedule: "0 12 * * 1",
    },
  ],
};

export default config;
