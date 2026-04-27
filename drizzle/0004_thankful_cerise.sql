CREATE TABLE "entity_services" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_id" text NOT NULL,
	"service_group_id" text NOT NULL,
	"org_id" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "service_group_rules" (
	"service_group_id" text NOT NULL,
	"rule_id" text NOT NULL,
	CONSTRAINT "service_group_rules_service_group_id_rule_id_pk" PRIMARY KEY("service_group_id","rule_id")
);
--> statement-breakpoint
CREATE TABLE "service_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"default_for_entity_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "affected_counties" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "entity_services" ADD CONSTRAINT "entity_services_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_services" ADD CONSTRAINT "entity_services_service_group_id_service_groups_id_fk" FOREIGN KEY ("service_group_id") REFERENCES "public"."service_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_services" ADD CONSTRAINT "entity_services_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_group_rules" ADD CONSTRAINT "service_group_rules_service_group_id_service_groups_id_fk" FOREIGN KEY ("service_group_id") REFERENCES "public"."service_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_group_rules" ADD CONSTRAINT "service_group_rules_rule_id_deadline_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."deadline_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_groups" ADD CONSTRAINT "service_groups_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "entity_services_active_idx" ON "entity_services" USING btree ("entity_id","service_group_id") WHERE "entity_services"."removed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "entity_services_entity_idx" ON "entity_services" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "entity_services_org_idx" ON "entity_services" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "service_group_rules_rule_idx" ON "service_group_rules" USING btree ("rule_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_groups_slug_org_idx" ON "service_groups" USING btree ("slug","org_id");--> statement-breakpoint
CREATE INDEX "service_groups_org_idx" ON "service_groups" USING btree ("org_id");