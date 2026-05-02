CREATE TABLE "deadline_subtasks" (
	"id" text PRIMARY KEY NOT NULL,
	"deadline_instance_id" text NOT NULL,
	"org_id" text NOT NULL,
	"label" text NOT NULL,
	"due_date" date NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"owner_user_id" text,
	"completed_at" timestamp with time zone,
	"completed_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deadline_subtasks" ADD CONSTRAINT "deadline_subtasks_deadline_instance_id_deadline_instances_id_fk" FOREIGN KEY ("deadline_instance_id") REFERENCES "public"."deadline_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadline_subtasks" ADD CONSTRAINT "deadline_subtasks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadline_subtasks" ADD CONSTRAINT "deadline_subtasks_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadline_subtasks" ADD CONSTRAINT "deadline_subtasks_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deadline_subtasks_deadline_idx" ON "deadline_subtasks" USING btree ("deadline_instance_id","sort_order");--> statement-breakpoint
CREATE INDEX "deadline_subtasks_org_owner_open_idx" ON "deadline_subtasks" USING btree ("org_id","owner_user_id","completed_at");--> statement-breakpoint
CREATE INDEX "deadline_subtasks_org_due_idx" ON "deadline_subtasks" USING btree ("org_id","due_date");