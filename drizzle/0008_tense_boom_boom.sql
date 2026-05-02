DROP INDEX "deadline_instances_org_status_idx";--> statement-breakpoint
DROP INDEX "deadline_instances_org_due_idx";--> statement-breakpoint
CREATE INDEX "deadline_instances_org_completed_idx" ON "deadline_instances" USING btree ("org_id","completed_at");--> statement-breakpoint
CREATE INDEX "deadline_instances_org_due_idx" ON "deadline_instances" USING btree ("org_id","due_date");--> statement-breakpoint
ALTER TABLE "deadline_instances" DROP COLUMN "status";--> statement-breakpoint
DROP TYPE "public"."deadline_status";