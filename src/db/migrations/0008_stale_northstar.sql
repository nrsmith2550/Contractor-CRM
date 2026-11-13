CREATE TABLE IF NOT EXISTS "work_order_product" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"product_id" uuid,
	"description" text NOT NULL,
	"quantity_milli" bigint NOT NULL,
	"unit_price_cents" bigint NOT NULL,
	"extended_cents" bigint DEFAULT 0 NOT NULL,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_order_service" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"resource_id" uuid,
	"description" text NOT NULL,
	"minutes" integer NOT NULL,
	"hourly_rate_cents" bigint NOT NULL,
	"extended_cents" bigint DEFAULT 0 NOT NULL,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_order_product" ADD CONSTRAINT "work_order_product_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_order_product" ADD CONSTRAINT "work_order_product_work_order_id_work_order_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_order"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_order_product" ADD CONSTRAINT "work_order_product_added_by_system_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_order_service" ADD CONSTRAINT "work_order_service_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_order_service" ADD CONSTRAINT "work_order_service_work_order_id_work_order_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_order"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_order_service" ADD CONSTRAINT "work_order_service_resource_id_bookable_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."bookable_resource"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_order_service" ADD CONSTRAINT "work_order_service_added_by_system_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "work_order_product_line_uq" ON "work_order_product" USING btree ("work_order_id","line_number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "work_order_service_line_uq" ON "work_order_service" USING btree ("work_order_id","line_number");