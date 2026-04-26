ALTER TABLE "memberships" ADD COLUMN "ical_token" text;--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_ical_token_idx" ON "memberships" USING btree ("ical_token");