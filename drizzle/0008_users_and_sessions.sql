CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
-- Decks from before accounts go to a placeholder owner nobody can log in to (no password).
-- `npm run db:claim -- <email>` hands them to a real account. Only created when there are decks.
INSERT INTO "users" ("id", "email", "password_hash")
	SELECT 'legacy', 'legacy@lexico.invalid', NULL WHERE EXISTS (SELECT 1 FROM "decks");--> statement-breakpoint
ALTER TABLE "words" DROP CONSTRAINT "words_deck_id_decks_id_fk";--> statement-breakpoint
DROP INDEX "words_deck_position_idx";--> statement-breakpoint
ALTER TABLE "decks" DROP CONSTRAINT "decks_pkey";--> statement-breakpoint
ALTER TABLE "words" DROP CONSTRAINT "words_pkey";--> statement-breakpoint
ALTER TABLE "decks" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "words" ADD COLUMN "user_id" text;--> statement-breakpoint
UPDATE "decks" SET "user_id" = 'legacy';--> statement-breakpoint
UPDATE "words" SET "user_id" = 'legacy';--> statement-breakpoint
ALTER TABLE "decks" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "words" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "decks" ADD CONSTRAINT "decks_user_id_id_pk" PRIMARY KEY("user_id","id");--> statement-breakpoint
ALTER TABLE "words" ADD CONSTRAINT "words_user_id_id_pk" PRIMARY KEY("user_id","id");--> statement-breakpoint
ALTER TABLE "decks" ADD CONSTRAINT "decks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "words" ADD CONSTRAINT "words_user_id_deck_id_decks_user_id_id_fk" FOREIGN KEY ("user_id","deck_id") REFERENCES "public"."decks"("user_id","id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "words_user_deck_position_idx" ON "words" USING btree ("user_id","deck_id","position");
