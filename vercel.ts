// DueDateHQ — Vercel project configuration (vercel.ts replaces vercel.json)
// https://vercel.com/docs/project-configuration/vercel-ts

import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  framework: "nextjs",
  buildCommand: "pnpm build",
  installCommand: "pnpm install --frozen-lockfile",

  crons: [
    // Daily 06:00 UTC scan — generate + send reminder emails for deadlines
    // at 30 / 14 / 3 / 1 days out. Also checks for IRS disaster updates
    // when V2 scraper ships.
    {
      path: "/api/cron/reminders",
      schedule: "0 6 * * *",
    },
  ],
};

export default config;
