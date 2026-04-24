CREATE TYPE "public"."actor_type" AS ENUM('user', 'agent', 'cron', 'system');--> statement-breakpoint
CREATE TYPE "public"."deadline_status" AS ENUM('pending', 'in_progress', 'completed', 'extended', 'missed', 'not_applicable');--> statement-breakpoint
CREATE TYPE "public"."entity_type" AS ENUM('individual', 'c_corp', 's_corp', 'partnership', 'llc', 'trust', 'estate', 'nonprofit');--> statement-breakpoint
CREATE TYPE "public"."jurisdiction_type" AS ENUM('federal', 'state', 'city');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."rule_type" AS ENUM('fixed_date', 'relative_to_year_end', 'quarterly_estimated', 'election_window');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"payload" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"primary_contact_email" text,
	"primary_contact_phone" text,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deadline_instances" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"rule_id" text NOT NULL,
	"tax_year" integer NOT NULL,
	"due_date" date NOT NULL,
	"status" "deadline_status" DEFAULT 'pending' NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by_user_id" text,
	"completed_by_actor_type" "actor_type",
	"extension_filed_at" timestamp with time zone,
	"extension_due_date" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deadline_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"jurisdiction_type" "jurisdiction_type" NOT NULL,
	"jurisdiction_code" text NOT NULL,
	"form_code" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"entity_types" jsonb NOT NULL,
	"rule_type" "rule_type" NOT NULL,
	"rule_payload" jsonb NOT NULL,
	"extension_form_code" text,
	"extension_payload" jsonb,
	"penalty_summary" text,
	"source_url" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"irrevocable" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"entity_type" "entity_type" NOT NULL,
	"ein" text,
	"home_state" text,
	"operating_states" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fiscal_year_end" text DEFAULT '12-31' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"org_id" text NOT NULL,
	"role" "membership_role" DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"plan" text DEFAULT 'beta' NOT NULL,
	"clerk_org_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_clerk_org_id_unique" UNIQUE("clerk_org_id")
);
--> statement-breakpoint
CREATE TABLE "reminders_sent" (
	"id" text PRIMARY KEY NOT NULL,
	"deadline_instance_id" text NOT NULL,
	"days_before_due" integer NOT NULL,
	"channel" text NOT NULL,
	"sent_to_email" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"clerk_user_id" text NOT NULL,
	"email" text NOT NULL,
	"full_name" text,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_clerk_user_id_unique" UNIQUE("clerk_user_id")
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadline_instances" ADD CONSTRAINT "deadline_instances_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadline_instances" ADD CONSTRAINT "deadline_instances_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadline_instances" ADD CONSTRAINT "deadline_instances_rule_id_deadline_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."deadline_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadline_instances" ADD CONSTRAINT "deadline_instances_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders_sent" ADD CONSTRAINT "reminders_sent_deadline_instance_id_deadline_instances_id_fk" FOREIGN KEY ("deadline_instance_id") REFERENCES "public"."deadline_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_org_time_idx" ON "audit_events" USING btree ("org_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_target_idx" ON "audit_events" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "clients_org_idx" ON "clients" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "clients_org_archived_idx" ON "clients" USING btree ("org_id","archived_at");--> statement-breakpoint
CREATE INDEX "deadline_instances_org_due_idx" ON "deadline_instances" USING btree ("org_id","due_date","status");--> statement-breakpoint
CREATE INDEX "deadline_instances_entity_idx" ON "deadline_instances" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "deadline_instances_org_status_idx" ON "deadline_instances" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "deadline_instances_unique_idx" ON "deadline_instances" USING btree ("entity_id","rule_id","tax_year");--> statement-breakpoint
CREATE INDEX "deadline_rules_jurisdiction_idx" ON "deadline_rules" USING btree ("jurisdiction_type","jurisdiction_code");--> statement-breakpoint
CREATE INDEX "deadline_rules_form_idx" ON "deadline_rules" USING btree ("form_code");--> statement-breakpoint
CREATE INDEX "entities_org_idx" ON "entities" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "entities_client_idx" ON "entities" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_user_org_idx" ON "memberships" USING btree ("user_id","org_id");--> statement-breakpoint
CREATE INDEX "memberships_org_idx" ON "memberships" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "organizations_clerk_org_id_idx" ON "organizations" USING btree ("clerk_org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reminders_dedupe_idx" ON "reminders_sent" USING btree ("deadline_instance_id","days_before_due","channel");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");