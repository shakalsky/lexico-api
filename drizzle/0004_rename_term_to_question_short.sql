-- Edited by hand: drizzle-kit left out DROP NOT NULL after the rename, and sentence cards move from "" to NULL.
ALTER TABLE "words" RENAME COLUMN "term" TO "question_short";--> statement-breakpoint
ALTER TABLE "words" ALTER COLUMN "question_short" DROP NOT NULL;--> statement-breakpoint
UPDATE "words" SET "question_short" = NULL WHERE "question_short" = '';