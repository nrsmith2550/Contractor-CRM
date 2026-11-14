CREATE TYPE "public"."license_edition" AS ENUM('complete', 'deals', 'jobs');--> statement-breakpoint
ALTER TABLE "license" ADD COLUMN "edition" "license_edition" DEFAULT 'complete' NOT NULL;