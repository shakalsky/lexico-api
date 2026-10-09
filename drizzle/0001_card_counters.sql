ALTER TABLE "words" ADD COLUMN "shows_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "words" ADD COLUMN "successes_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "words" ADD COLUMN "failures_count" integer DEFAULT 0 NOT NULL;