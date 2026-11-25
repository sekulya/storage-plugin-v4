CREATE TABLE "storage_locations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"zone_id" text NOT NULL,
	"code" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_movement_tags" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"movement_id" text NOT NULL,
	"tag_id" text NOT NULL,
	"taken" numeric(14, 3) NOT NULL,
	CONSTRAINT "storage_movement_tags_taken_check" CHECK ("storage_movement_tags"."taken" >= 0)
);
--> statement-breakpoint
ALTER TABLE "storage_movement_items" DROP CONSTRAINT "storage_movement_items_counts_check";--> statement-breakpoint
ALTER TABLE "storage_rfid_tags" DROP CONSTRAINT "storage_rfid_tags_units_check";--> statement-breakpoint
ALTER TABLE "storage_rfid_tags" DROP CONSTRAINT "storage_rfid_tags_opened_check";--> statement-breakpoint
ALTER TABLE "storage_movement_items" ALTER COLUMN "units" SET DATA TYPE numeric(14, 3);--> statement-breakpoint
ALTER TABLE "storage_rfid_tags" ALTER COLUMN "units_in_pack" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_rfid_tags" ADD COLUMN "packaging" text;--> statement-breakpoint
ALTER TABLE "storage_rfid_tags" ADD COLUMN "quantity" numeric(14, 3);--> statement-breakpoint
ALTER TABLE "storage_rfid_tags" ADD COLUMN "remaining" numeric(14, 3);--> statement-breakpoint
-- Existing tags become boxes holding their old units. Forced row-level security hides every row
-- from a session without an organisation, so the backfill runs with it off.
ALTER TABLE "storage_rfid_tags" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "storage_rfid_tags" SET "packaging" = 'box', "quantity" = "units_in_pack", "remaining" = "units_in_pack";--> statement-breakpoint
ALTER TABLE "storage_rfid_tags" ALTER COLUMN "packaging" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_rfid_tags" ALTER COLUMN "quantity" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_rfid_tags" ALTER COLUMN "remaining" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_rfid_tags" ADD COLUMN "location_id" text;--> statement-breakpoint
ALTER TABLE "storage_rfid_tags" ADD COLUMN "replaced_by" text;--> statement-breakpoint
ALTER TABLE "storage_scan_products" ADD COLUMN "expected_quantity" numeric(14, 3) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_scan_products" ADD COLUMN "scanned_quantity" numeric(14, 3) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_scans" ADD COLUMN "location_id" text;--> statement-breakpoint
ALTER TABLE "storage_scans" ADD COLUMN "status" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_scans" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "storage_scans" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "storage_scans" ADD COLUMN "movement_id" text;--> statement-breakpoint
ALTER TABLE "storage_locations" ADD CONSTRAINT "storage_locations_zone_id_storage_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."storage_zones"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_movement_tags" ADD CONSTRAINT "storage_movement_tags_movement_id_storage_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."storage_movements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_movement_tags" ADD CONSTRAINT "storage_movement_tags_tag_id_storage_rfid_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."storage_rfid_tags"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "storage_locations_org_zone_idx" ON "storage_locations" USING btree ("org_id","zone_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "storage_locations_zone_code_key" ON "storage_locations" USING btree ("org_id","zone_id",lower("code"));--> statement-breakpoint
CREATE UNIQUE INDEX "storage_movement_tags_org_movement_tag_key" ON "storage_movement_tags" USING btree ("org_id","movement_id","tag_id");--> statement-breakpoint
CREATE INDEX "storage_movement_tags_org_tag_idx" ON "storage_movement_tags" USING btree ("org_id","tag_id");--> statement-breakpoint
ALTER TABLE "storage_rfid_tags" ADD CONSTRAINT "storage_rfid_tags_location_id_storage_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."storage_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_scans" ADD CONSTRAINT "storage_scans_location_id_storage_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."storage_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_scans" ADD CONSTRAINT "storage_scans_movement_id_storage_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."storage_movements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "storage_rfid_tags_org_location_idx" ON "storage_rfid_tags" USING btree ("org_id","location_id");--> statement-breakpoint
ALTER TABLE "storage_movement_items" ADD CONSTRAINT "storage_movement_items_amounts_check" CHECK ("storage_movement_items"."packs" > 0 and "storage_movement_items"."units" >= 0);--> statement-breakpoint
ALTER TABLE "storage_rfid_tags" ADD CONSTRAINT "storage_rfid_tags_amount_check" CHECK ("storage_rfid_tags"."quantity" > 0 and "storage_rfid_tags"."remaining" >= 0 and "storage_rfid_tags"."remaining" <= "storage_rfid_tags"."quantity");--> statement-breakpoint
ALTER TABLE "storage_rfid_tags" ADD CONSTRAINT "storage_rfid_tags_status_check" CHECK ("storage_rfid_tags"."status" in ('sealed', 'opened', 'empty', 'replaced')
        and ("storage_rfid_tags"."status" <> 'sealed' or "storage_rfid_tags"."remaining" = "storage_rfid_tags"."quantity")
        and ("storage_rfid_tags"."status" <> 'empty' or "storage_rfid_tags"."remaining" = 0)
        and (("storage_rfid_tags"."status" = 'replaced') = ("storage_rfid_tags"."replaced_by" is not null)));--> statement-breakpoint
ALTER TABLE "storage_scans" ADD CONSTRAINT "storage_scans_review_check" CHECK ("storage_scans"."status" in ('draft', 'approved', 'rejected')
        and (("storage_scans"."status" = 'draft') = ("storage_scans"."reviewed_by" is null))
        and (("storage_scans"."status" = 'draft') = ("storage_scans"."reviewed_at" is null)));--> statement-breakpoint
INSERT INTO "storage_movement_tags" ("id", "org_id", "movement_id", "tag_id", "taken")
  SELECT gen_random_uuid()::text, "org_id", "movement_id", "id", 0 FROM "storage_rfid_tags" WHERE "movement_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_rfid_tags" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
SELECT core_enable_tenant_rls('storage_locations');--> statement-breakpoint
SELECT core_enable_tenant_rls('storage_movement_tags');
