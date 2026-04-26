ALTER TYPE "public"."deadline_status" ADD VALUE 'waiting_on_client' BEFORE 'in_progress';--> statement-breakpoint
ALTER TYPE "public"."deadline_status" ADD VALUE 'ready_to_file' BEFORE 'completed';--> statement-breakpoint
CREATE TABLE "announcement_client_acks" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"announcement_id" text NOT NULL,
	"client_id" text NOT NULL,
	"acked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "announcement_dismissals" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"announcement_id" text NOT NULL,
	"dismissed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"url" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"affected_jurisdictions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"relevance_score" integer DEFAULT 3 NOT NULL,
	"ai_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"org_id" text NOT NULL,
	"name" text,
	"email" text,
	"phone" text,
	"role" text,
	"priority" integer DEFAULT 100 NOT NULL,
	"receives_reminders" boolean DEFAULT true NOT NULL,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "digest_sends" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"week_key" text NOT NULL,
	"digest_type" text DEFAULT 'weekly' NOT NULL,
	"recipient_email" text NOT NULL,
	"deadline_count" integer DEFAULT 0 NOT NULL,
	"urgent_count" integer DEFAULT 0 NOT NULL,
	"ai_summary" text,
	"provider_message_id" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "announcement_client_acks" ADD CONSTRAINT "announcement_client_acks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_client_acks" ADD CONSTRAINT "announcement_client_acks_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_client_acks" ADD CONSTRAINT "announcement_client_acks_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_dismissals" ADD CONSTRAINT "announcement_dismissals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_dismissals" ADD CONSTRAINT "announcement_dismissals_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_sends" ADD CONSTRAINT "digest_sends_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_sends" ADD CONSTRAINT "digest_sends_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ann_client_ack_user_ann_client_idx" ON "announcement_client_acks" USING btree ("user_id","announcement_id","client_id");--> statement-breakpoint
CREATE INDEX "ann_client_ack_ann_user_idx" ON "announcement_client_acks" USING btree ("announcement_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "announcement_dismissals_user_ann_idx" ON "announcement_dismissals" USING btree ("user_id","announcement_id");--> statement-breakpoint
CREATE INDEX "announcement_dismissals_user_idx" ON "announcement_dismissals" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "announcements_source_external_idx" ON "announcements" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "announcements_published_idx" ON "announcements" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "announcements_score_published_idx" ON "announcements" USING btree ("relevance_score","published_at");--> statement-breakpoint
CREATE INDEX "client_contacts_client_idx" ON "client_contacts" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "client_contacts_client_priority_idx" ON "client_contacts" USING btree ("client_id","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "digest_sends_user_week_idx" ON "digest_sends" USING btree ("user_id","week_key","digest_type");--> statement-breakpoint
CREATE INDEX "digest_sends_org_idx" ON "digest_sends" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deadline_rules_natural_key_idx" ON "deadline_rules" USING btree ("jurisdiction_code","form_code","title","version");