CREATE TYPE "public"."notification_kind" AS ENUM('deadline_t_minus_7', 'deadline_t_minus_3', 'deadline_t_minus_1', 'stage_t_minus_1');--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"deadline_instance_id" text NOT NULL,
	"subtask_id" text,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link_path" text NOT NULL,
	"delivered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "notifications_dedupe_idx" UNIQUE NULLS NOT DISTINCT("user_id","deadline_instance_id","subtask_id","kind")
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_deadline_instance_id_deadline_instances_id_fk" FOREIGN KEY ("deadline_instance_id") REFERENCES "public"."deadline_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_subtask_id_deadline_subtasks_id_fk" FOREIGN KEY ("subtask_id") REFERENCES "public"."deadline_subtasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("user_id","delivered_at") WHERE "notifications"."read_at" IS NULL;--> statement-breakpoint
CREATE INDEX "notifications_user_recent_idx" ON "notifications" USING btree ("user_id","delivered_at");