ALTER TABLE "announcements" ADD COLUMN "affected_form_codes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "original_deadline_start" text;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "original_deadline_end" text;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "relief_deadline" text;