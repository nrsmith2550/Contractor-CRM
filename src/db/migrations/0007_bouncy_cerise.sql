CREATE TABLE IF NOT EXISTS "bookable_resource" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_by" uuid,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"state_code" text DEFAULT 'active' NOT NULL,
	"name" text NOT NULL,
	"resource_type" text DEFAULT 'user' NOT NULL,
	"user_id" uuid,
	"work_hours" jsonb NOT NULL,
	"color" text,
	"address_street" text,
	"address_city" text,
	"address_region" text,
	"address_postal_code" text,
	"address_country" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "characteristic" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_by" uuid,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"state_code" text DEFAULT 'active' NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "resource_booking" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_by" uuid,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"state_code" text DEFAULT 'active' NOT NULL,
	"resource_id" uuid NOT NULL,
	"work_order_id" uuid,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"notes" text,
	"travelling_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"signature_data_url" text,
	"signed_by_name" text,
	"signed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "resource_characteristic" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"characteristic_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_order_skill" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"characteristic_id" uuid NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bookable_resource" ADD CONSTRAINT "bookable_resource_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bookable_resource" ADD CONSTRAINT "bookable_resource_owner_id_system_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bookable_resource" ADD CONSTRAINT "bookable_resource_created_by_system_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bookable_resource" ADD CONSTRAINT "bookable_resource_modified_by_system_user_id_fk" FOREIGN KEY ("modified_by") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bookable_resource" ADD CONSTRAINT "bookable_resource_user_id_system_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "characteristic" ADD CONSTRAINT "characteristic_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "characteristic" ADD CONSTRAINT "characteristic_owner_id_system_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "characteristic" ADD CONSTRAINT "characteristic_created_by_system_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "characteristic" ADD CONSTRAINT "characteristic_modified_by_system_user_id_fk" FOREIGN KEY ("modified_by") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resource_booking" ADD CONSTRAINT "resource_booking_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resource_booking" ADD CONSTRAINT "resource_booking_owner_id_system_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resource_booking" ADD CONSTRAINT "resource_booking_created_by_system_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resource_booking" ADD CONSTRAINT "resource_booking_modified_by_system_user_id_fk" FOREIGN KEY ("modified_by") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resource_booking" ADD CONSTRAINT "resource_booking_resource_id_bookable_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."bookable_resource"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resource_booking" ADD CONSTRAINT "resource_booking_work_order_id_work_order_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_order"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resource_characteristic" ADD CONSTRAINT "resource_characteristic_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resource_characteristic" ADD CONSTRAINT "resource_characteristic_resource_id_bookable_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."bookable_resource"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resource_characteristic" ADD CONSTRAINT "resource_characteristic_characteristic_id_characteristic_id_fk" FOREIGN KEY ("characteristic_id") REFERENCES "public"."characteristic"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_order_skill" ADD CONSTRAINT "work_order_skill_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_order_skill" ADD CONSTRAINT "work_order_skill_work_order_id_work_order_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_order"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_order_skill" ADD CONSTRAINT "work_order_skill_characteristic_id_characteristic_id_fk" FOREIGN KEY ("characteristic_id") REFERENCES "public"."characteristic"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bookable_resource_name_uq" ON "bookable_resource" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "characteristic_name_uq" ON "characteristic" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_resource_time_idx" ON "resource_booking" USING btree ("tenant_id","resource_id","start_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_work_order_idx" ON "resource_booking" USING btree ("tenant_id","work_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "resource_characteristic_uq" ON "resource_characteristic" USING btree ("resource_id","characteristic_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "work_order_skill_uq" ON "work_order_skill" USING btree ("work_order_id","characteristic_id");