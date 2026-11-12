CREATE TABLE IF NOT EXISTS "incident" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_by" uuid,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"state_code" text DEFAULT 'active' NOT NULL,
	"ticket_number" text NOT NULL,
	"title" text NOT NULL,
	"customer_account_id" uuid,
	"customer_contact_id" uuid,
	"subject_id" uuid,
	"queue_id" uuid,
	"case_type" text DEFAULT 'problem' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"origin" text DEFAULT 'phone' NOT NULL,
	"description" text,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"resolution" text,
	"billable_minutes" integer,
	"sla_due_at" timestamp with time zone,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "queue" (
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
CREATE TABLE IF NOT EXISTS "subject" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_by" uuid,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"state_code" text DEFAULT 'active' NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_by" uuid,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"state_code" text DEFAULT 'active' NOT NULL,
	"wo_number" text NOT NULL,
	"title" text NOT NULL,
	"incident_id" uuid,
	"service_account_id" uuid,
	"incident_type" text,
	"work_order_type" text DEFAULT 'repair' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"instructions" text,
	"address_street" text,
	"address_city" text,
	"address_region" text,
	"address_postal_code" text,
	"address_country" text,
	"latitude" double precision,
	"longitude" double precision,
	"time_window_start" timestamp with time zone,
	"time_window_end" timestamp with time zone,
	"est_duration_min" integer,
	"status" text DEFAULT 'unscheduled' NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incident" ADD CONSTRAINT "incident_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incident" ADD CONSTRAINT "incident_owner_id_system_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incident" ADD CONSTRAINT "incident_created_by_system_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incident" ADD CONSTRAINT "incident_modified_by_system_user_id_fk" FOREIGN KEY ("modified_by") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incident" ADD CONSTRAINT "incident_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incident" ADD CONSTRAINT "incident_queue_id_queue_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."queue"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "queue" ADD CONSTRAINT "queue_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "queue" ADD CONSTRAINT "queue_owner_id_system_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "queue" ADD CONSTRAINT "queue_created_by_system_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "queue" ADD CONSTRAINT "queue_modified_by_system_user_id_fk" FOREIGN KEY ("modified_by") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subject" ADD CONSTRAINT "subject_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subject" ADD CONSTRAINT "subject_owner_id_system_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subject" ADD CONSTRAINT "subject_created_by_system_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subject" ADD CONSTRAINT "subject_modified_by_system_user_id_fk" FOREIGN KEY ("modified_by") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_order" ADD CONSTRAINT "work_order_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_order" ADD CONSTRAINT "work_order_owner_id_system_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_order" ADD CONSTRAINT "work_order_created_by_system_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_order" ADD CONSTRAINT "work_order_modified_by_system_user_id_fk" FOREIGN KEY ("modified_by") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_order" ADD CONSTRAINT "work_order_incident_id_incident_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incident"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "incident_ticket_uq" ON "incident" USING btree ("tenant_id","ticket_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incident_status_idx" ON "incident" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incident_owner_idx" ON "incident" USING btree ("tenant_id","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "queue_name_uq" ON "queue" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "subject_name_uq" ON "subject" USING btree ("tenant_id","parent_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "work_order_number_uq" ON "work_order" USING btree ("tenant_id","wo_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_order_status_idx" ON "work_order" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_order_incident_idx" ON "work_order" USING btree ("tenant_id","incident_id");