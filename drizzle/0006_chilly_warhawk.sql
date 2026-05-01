ALTER TABLE "deadline_instances" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "deadline_instances" ALTER COLUMN "status" SET DEFAULT 'pending'::text;--> statement-breakpoint
DROP TYPE "public"."deadline_status";--> statement-breakpoint
CREATE TYPE "public"."deadline_status" AS ENUM('pending', 'waiting_on_client', 'in_progress', 'completed');--> statement-breakpoint
ALTER TABLE "deadline_instances" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."deadline_status";--> statement-breakpoint
ALTER TABLE "deadline_instances" ALTER COLUMN "status" SET DATA TYPE "public"."deadline_status" USING "status"::"public"."deadline_status";--> statement-breakpoint
ALTER TABLE "deadline_instances" ADD COLUMN "is_extended" boolean DEFAULT false NOT NULL;