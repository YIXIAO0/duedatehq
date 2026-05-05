/**
 * One-off: rename the user whose email is in the .env.local owner
 * (the developer using this dev DB) to "Grace Liu" with a fake
 * example email. Used to redact identifying info before taking
 * marketing screenshots.
 *
 * Reversible — run again with the original values to flip back.
 *
 * NB: only updates our `users` table. The Clerk-side identity is
 * untouched, so login still works under the original Clerk email.
 * Display surfaces (avatar initials, owner picker, reminder emails)
 * read from `users.full_name` / `users.email`, so the screenshot
 * will show "Grace Liu" / "grace@example.com".
 */

import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import { users } from "../src/lib/db/schema";

config({ path: ".env.local" });
const db = drizzle(neon(process.env.DATABASE_URL!), { schema: { users } });

const REAL_EMAIL = "yxiao@dify.ai";
const NEW_NAME = "Grace Liu";
const NEW_EMAIL = "grace@example.com";

async function main() {
  const result = await db
    .update(users)
    .set({ fullName: NEW_NAME, email: NEW_EMAIL, updatedAt: new Date() })
    .where(eq(users.email, REAL_EMAIL))
    .returning({ id: users.id, email: users.email, fullName: users.fullName });

  if (result.length === 0) {
    console.log(
      `No user matched email=${REAL_EMAIL} — already renamed, or run with the right REAL_EMAIL.`,
    );
    return;
  }
  console.log("Renamed:", result);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
