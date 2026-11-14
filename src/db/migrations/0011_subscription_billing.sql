ALTER TABLE "license" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "license" ADD COLUMN "billing_status" text;--> statement-breakpoint
ALTER TABLE "license" ADD COLUMN "current_period_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "license" ADD COLUMN "cancel_at_period_end" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "license" ADD COLUMN "extra_users" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "license" ADD CONSTRAINT "license_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id");