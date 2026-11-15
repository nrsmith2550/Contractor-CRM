CREATE TABLE IF NOT EXISTS "consultation_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"business" text NOT NULL,
	"trade" text NOT NULL,
	"team_size" text NOT NULL,
	"best_time" text NOT NULL,
	"time_zone" text NOT NULL,
	"message" text,
	"status" text DEFAULT 'new' NOT NULL,
	"notes" text,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consultation_request_created_idx" ON "consultation_request" USING btree ("created_at");