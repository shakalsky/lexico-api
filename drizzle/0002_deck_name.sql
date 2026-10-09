-- Edited by hand: existing decks are named after their id before the column becomes required.
ALTER TABLE "decks" ADD COLUMN "name" text;--> statement-breakpoint
UPDATE "decks" SET "name" = "id";--> statement-breakpoint
ALTER TABLE "decks" ALTER COLUMN "name" SET NOT NULL;
