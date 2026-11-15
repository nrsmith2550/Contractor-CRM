CREATE TABLE IF NOT EXISTS "job_phase" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"phase_number" integer NOT NULL,
	"title" text NOT NULL,
	"instructions" text,
	"status" text DEFAULT 'unscheduled' NOT NULL,
	"est_duration_min" integer,
	"completed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_by" uuid,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_phase" ADD CONSTRAINT "job_phase_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_phase" ADD CONSTRAINT "job_phase_work_order_id_work_order_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_order"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_phase" ADD CONSTRAINT "job_phase_created_by_system_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_phase" ADD CONSTRAINT "job_phase_modified_by_system_user_id_fk" FOREIGN KEY ("modified_by") REFERENCES "public"."system_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "job_phase_number_uq" ON "job_phase" USING btree ("work_order_id","phase_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_phase_status_idx" ON "job_phase" USING btree ("tenant_id","status");