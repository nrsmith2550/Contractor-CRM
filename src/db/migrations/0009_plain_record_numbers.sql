-- Screens were renamed to plain words (Lead -> Prospect, Work order -> Job ...), so the numbers
-- shown on them follow: LEAD- becomes PROS-, ACC- CUST-, CON- PERS-, OPP- DEAL-, CAS- REQ-, WO- JOB-.
-- Only the prefix changes; the counter and the digits stay, so every number stays unique.
UPDATE "sequence" SET "prefix" = 'PROS' WHERE "entity" = 'lead' AND "prefix" = 'LEAD';--> statement-breakpoint
UPDATE "sequence" SET "prefix" = 'CUST' WHERE "entity" = 'account' AND "prefix" = 'ACC';--> statement-breakpoint
UPDATE "sequence" SET "prefix" = 'PERS' WHERE "entity" = 'contact' AND "prefix" = 'CON';--> statement-breakpoint
UPDATE "sequence" SET "prefix" = 'DEAL' WHERE "entity" = 'opportunity' AND "prefix" = 'OPP';--> statement-breakpoint
UPDATE "sequence" SET "prefix" = 'REQ' WHERE "entity" = 'case' AND "prefix" = 'CAS';--> statement-breakpoint
UPDATE "sequence" SET "prefix" = 'JOB' WHERE "entity" = 'work_order' AND "prefix" = 'WO';--> statement-breakpoint
UPDATE "lead" SET "lead_number" = 'PROS-' || substr("lead_number", 6) WHERE "lead_number" LIKE 'LEAD-%';--> statement-breakpoint
UPDATE "account" SET "account_number" = 'CUST-' || substr("account_number", 5) WHERE "account_number" LIKE 'ACC-%';--> statement-breakpoint
UPDATE "contact" SET "contact_number" = 'PERS-' || substr("contact_number", 5) WHERE "contact_number" LIKE 'CON-%';--> statement-breakpoint
UPDATE "opportunity" SET "opportunity_number" = 'DEAL-' || substr("opportunity_number", 5) WHERE "opportunity_number" LIKE 'OPP-%';--> statement-breakpoint
UPDATE "incident" SET "ticket_number" = 'REQ-' || substr("ticket_number", 5) WHERE "ticket_number" LIKE 'CAS-%';--> statement-breakpoint
UPDATE "work_order" SET "wo_number" = 'JOB-' || substr("wo_number", 4) WHERE "wo_number" LIKE 'WO-%';
