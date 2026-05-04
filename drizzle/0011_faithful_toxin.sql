CREATE TABLE "entity_elections" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_id" text NOT NULL,
	"org_id" text NOT NULL,
	"jurisdiction_code" text NOT NULL,
	"kind" text NOT NULL,
	"elected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deadline_rules" ADD COLUMN "requires_election" text;--> statement-breakpoint
ALTER TABLE "entity_elections" ADD CONSTRAINT "entity_elections_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_elections" ADD CONSTRAINT "entity_elections_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "entity_elections_unique_idx" ON "entity_elections" USING btree ("entity_id","jurisdiction_code","kind");--> statement-breakpoint
CREATE INDEX "entity_elections_entity_idx" ON "entity_elections" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "entity_elections_org_idx" ON "entity_elections" USING btree ("org_id");