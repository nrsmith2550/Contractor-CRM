ALTER TABLE "resource_booking" ADD COLUMN "phase_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resource_booking" ADD CONSTRAINT "resource_booking_phase_id_job_phase_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."job_phase"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_phase_idx" ON "resource_booking" USING btree ("phase_id");