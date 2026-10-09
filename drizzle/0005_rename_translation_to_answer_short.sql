-- Edited by hand: drizzle-kit left out DROP NOT NULL after the rename, and empty answers move from "" to NULL.
ALTER TABLE "words" RENAME COLUMN "translation" TO "answer_short";--> statement-breakpoint
ALTER TABLE "words" ALTER COLUMN "answer_short" DROP NOT NULL;--> statement-breakpoint
UPDATE "words" SET "answer_short" = NULL WHERE "answer_short" = '';