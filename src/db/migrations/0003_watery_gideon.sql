CREATE TABLE IF NOT EXISTS "account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_by" uuid,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"state_code" text DEFAULT 'active' NOT NULL,
	"account_number" text NOT NULL,
	"name" text NOT NULL,
	"primary_contact_id" uuid,
	"parent_account_id" uuid,
	"phone" text,
	"website" text,
	"industry" text,
	"address_street" text,
	"address_city" text,
	"address_region" text,
	"address_postal_code" text,
	"address_country" text,
	"relationship_type" text DEFAULT 'prospect' NOT NULL,
	"credit_limit_cents" bigint,
	"payment_terms" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_by" uuid,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"state_code" text DEFAULT 'active' NOT NULL,
	"activity_type" text NOT NULL,
	"subject" text NOT NULL,
	"description" text,
	"regarding_type" text,
	"regarding_id" uuid,
	"scheduled_start" timestamp with time zone,
	"scheduled_end" timestamp with time zone,
	"due_at" timestamp with time zone,
	"priority" text DEFAULT 'normal' NOT NULL,
	"direction" text,
	"status" text DEFAULT 'open' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "annotation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_by" uuid,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"state_code" text DEFAULT 'active' NOT NULL,
	"regarding_type" text NOT NULL,
	"regarding_id" uuid NOT NULL,
	"title" text,
	"body" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_by" uuid,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"state_code" text DEFAULT 'active' NOT NULL,
	"contact_number" text NOT NULL,
	"first_name" text,
	"last_name" text NOT NULL,
	"parent_account_id" uuid,
	"job_title" text,
	"email" text,
	"mobile" text,
	"business_phone" text,
	"address_street" text,
	"address_city" text,
	"address_region" text,
	"address_postal_code" text,
	"address_country" text,
	"preferred_contact_method" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lead" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_by" uuid,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"state_code" text DEFAULT 'active' NOT NULL,
	"lead_number" text NOT NULL,
	"topic" text NOT NULL,
	"first_name" text,
	"last_name" text NOT NULL,
	"job_title" text,
	"company_name" text,
	"email" text,
	"phone" text,
	"address_street" text,
	"address_city" text,
	"address_region" text,
	"address_postal_code" text,
	"address_country" text,
	"lead_source" text,
	"rating" text,
	"est_value_cents" bigint,
	"status" text DEFAULT 'new' NOT NULL,
	"disqualify_reason" text,
	"qualified_account_id" uuid,
	"qualified_contact_id" uuid,
	"qualified_opportunity_id" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "opportunity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_by" uuid,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"state_code" text DEFAULT 'active' NOT NULL,
	"opportunity_number" text NOT NULL,
	"name" text NOT NULL,
	"customer_account_id" uuid,
	"customer_contact_id" uuid,
	"originating_lead_id" uuid,
	"est_revenue_cents" bigint DEFAULT 0 NOT NULL,
	"est_close_date" date,
	"probability" integer DEFAULT 10 NOT NULL,
	"stage" text DEFAULT 'qualify' NOT NULL,
	"budget_cents" bigint,
	"purchase_timeframe" text,
	"proposal_delivered" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"close_reason" text,
	"competitor" text,
	"actual_revenue_cents" bigint,
	"actual_close_date" date
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "saved_view" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_id" uuid,
	"entity" text NOT NULL,
	"name" text NOT NULL,
	"columns" jsonb NOT NULL,
	"filters" jsonb NOT NULL,
	"sort" jsonb,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account" ADD CONSTRAINT "account_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account" ADD CONSTRAINT "account_owner_id_system_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account" ADD CONSTRAINT "account_created_by_system_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account" ADD CONSTRAINT "account_modified_by_system_user_id_fk" FOREIGN KEY ("modified_by") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activity" ADD CONSTRAINT "activity_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activity" ADD CONSTRAINT "activity_owner_id_system_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activity" ADD CONSTRAINT "activity_created_by_system_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activity" ADD CONSTRAINT "activity_modified_by_system_user_id_fk" FOREIGN KEY ("modified_by") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "annotation" ADD CONSTRAINT "annotation_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "annotation" ADD CONSTRAINT "annotation_owner_id_system_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "annotation" ADD CONSTRAINT "annotation_created_by_system_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "annotation" ADD CONSTRAINT "annotation_modified_by_system_user_id_fk" FOREIGN KEY ("modified_by") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact" ADD CONSTRAINT "contact_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact" ADD CONSTRAINT "contact_owner_id_system_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact" ADD CONSTRAINT "contact_created_by_system_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact" ADD CONSTRAINT "contact_modified_by_system_user_id_fk" FOREIGN KEY ("modified_by") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead" ADD CONSTRAINT "lead_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead" ADD CONSTRAINT "lead_owner_id_system_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead" ADD CONSTRAINT "lead_created_by_system_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead" ADD CONSTRAINT "lead_modified_by_system_user_id_fk" FOREIGN KEY ("modified_by") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_owner_id_system_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_created_by_system_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_modified_by_system_user_id_fk" FOREIGN KEY ("modified_by") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_owner_id_system_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "account_number_uq" ON "account" USING btree ("tenant_id","account_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_owner_idx" ON "account" USING btree ("tenant_id","owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_name_idx" ON "account" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_regarding_idx" ON "activity" USING btree ("tenant_id","regarding_type","regarding_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_owner_idx" ON "activity" USING btree ("tenant_id","owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "annotation_regarding_idx" ON "annotation" USING btree ("tenant_id","regarding_type","regarding_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contact_number_uq" ON "contact" USING btree ("tenant_id","contact_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_owner_idx" ON "contact" USING btree ("tenant_id","owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_account_idx" ON "contact" USING btree ("tenant_id","parent_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lead_number_uq" ON "lead" USING btree ("tenant_id","lead_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_owner_idx" ON "lead" USING btree ("tenant_id","owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_status_idx" ON "lead" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "opportunity_number_uq" ON "opportunity" USING btree ("tenant_id","opportunity_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opportunity_owner_idx" ON "opportunity" USING btree ("tenant_id","owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opportunity_status_stage_idx" ON "opportunity" USING btree ("tenant_id","status","stage");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saved_view_entity_idx" ON "saved_view" USING btree ("tenant_id","entity");