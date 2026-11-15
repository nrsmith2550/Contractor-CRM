ALTER TABLE "work_order_product" ADD COLUMN "phase_id" uuid;--> statement-breakpoint
ALTER TABLE "work_order_service" ADD COLUMN "phase_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_order_product" ADD CONSTRAINT "work_order_product_phase_id_job_phase_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."job_phase"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_order_service" ADD CONSTRAINT "work_order_service_phase_id_job_phase_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."job_phase"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
