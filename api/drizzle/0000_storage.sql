CREATE TABLE "storage_movement_items" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"movement_id" text NOT NULL,
	"product_id" text NOT NULL,
	"packs" integer NOT NULL,
	"units" integer NOT NULL,
	CONSTRAINT "storage_movement_items_counts_check" CHECK ("storage_movement_items"."packs" > 0 and "storage_movement_items"."units" > 0)
);
--> statement-breakpoint
CREATE TABLE "storage_movements" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"request_key" text NOT NULL,
	"type" text NOT NULL,
	"number" text NOT NULL,
	"zone_id" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_rfid_tags" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"epc_id" text NOT NULL,
	"product_id" text NOT NULL,
	"units_in_pack" integer NOT NULL,
	"zone_id" text NOT NULL,
	"status" text DEFAULT 'sealed' NOT NULL,
	"batch_id" text NOT NULL,
	"movement_id" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storage_rfid_tags_epc_check" CHECK ("storage_rfid_tags"."epc_id" ~ '^[0-9A-F]{24}$'),
	CONSTRAINT "storage_rfid_tags_units_check" CHECK ("storage_rfid_tags"."units_in_pack" > 0),
	CONSTRAINT "storage_rfid_tags_opened_check" CHECK (("storage_rfid_tags"."status" = 'opened') = ("storage_rfid_tags"."movement_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "storage_scan_products" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"scan_id" text NOT NULL,
	"product_id" text NOT NULL,
	"expected_packs" integer NOT NULL,
	"scanned_packs" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_scans" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"zone_id" text NOT NULL,
	"scanned_count" integer NOT NULL,
	"matched_count" integer NOT NULL,
	"missing_count" integer NOT NULL,
	"unknown_count" integer NOT NULL,
	"opened_count" integer NOT NULL,
	"other_zone_count" integer NOT NULL,
	"missing_epc_ids" text[] NOT NULL,
	"unknown_epc_ids" text[] NOT NULL,
	"opened_epc_ids" text[] NOT NULL,
	"other_zone_epc_ids" text[] NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_zones" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "storage_movement_items" ADD CONSTRAINT "storage_movement_items_movement_id_storage_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."storage_movements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_movements" ADD CONSTRAINT "storage_movements_zone_id_storage_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."storage_zones"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_rfid_tags" ADD CONSTRAINT "storage_rfid_tags_zone_id_storage_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."storage_zones"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_rfid_tags" ADD CONSTRAINT "storage_rfid_tags_movement_id_storage_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."storage_movements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_scan_products" ADD CONSTRAINT "storage_scan_products_scan_id_storage_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."storage_scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_scans" ADD CONSTRAINT "storage_scans_zone_id_storage_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."storage_zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "storage_movement_items_movement_product_key" ON "storage_movement_items" USING btree ("movement_id","product_id");--> statement-breakpoint
CREATE INDEX "storage_movements_org_created_idx" ON "storage_movements" USING btree ("org_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "storage_movements_org_request_key" ON "storage_movements" USING btree ("org_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "storage_rfid_tags_org_epc_key" ON "storage_rfid_tags" USING btree ("org_id","epc_id");--> statement-breakpoint
CREATE INDEX "storage_rfid_tags_org_zone_status_idx" ON "storage_rfid_tags" USING btree ("org_id","zone_id","status","product_id");--> statement-breakpoint
CREATE INDEX "storage_rfid_tags_org_created_idx" ON "storage_rfid_tags" USING btree ("org_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "storage_rfid_tags_movement_idx" ON "storage_rfid_tags" USING btree ("movement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "storage_scan_products_scan_product_key" ON "storage_scan_products" USING btree ("scan_id","product_id");--> statement-breakpoint
CREATE INDEX "storage_scans_org_zone_created_idx" ON "storage_scans" USING btree ("org_id","zone_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "storage_zones_org_created_idx" ON "storage_zones" USING btree ("org_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "storage_zones_org_name_key" ON "storage_zones" USING btree ("org_id",lower("name"));--> statement-breakpoint
SELECT core_enable_tenant_rls('storage_zones');--> statement-breakpoint
SELECT core_enable_tenant_rls('storage_movements');--> statement-breakpoint
SELECT core_enable_tenant_rls('storage_movement_items');--> statement-breakpoint
SELECT core_enable_tenant_rls('storage_rfid_tags');--> statement-breakpoint
SELECT core_enable_tenant_rls('storage_scans');--> statement-breakpoint
SELECT core_enable_tenant_rls('storage_scan_products');
