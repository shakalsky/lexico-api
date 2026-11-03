import {
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  /** Stored lowercased, so lookups are case-insensitive. */
  email: text('email').notNull().unique(),
  /**
   * `scrypt$N$r$p$salt$hash`, see `src/auth/password.ts`. Null for an account nobody can log
   * in to, such as the placeholder owner of decks created before accounts existed.
   */
  passwordHash: text('password_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Owns the decks that existed before accounts did, until `npm run db:claim` hands them over. */
export const LEGACY_USER_ID = 'legacy';

export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 of the bearer token, hex. The token itself is never stored. */
    tokenHash: text('token_hash').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('sessions_user_id_idx').on(table.userId)],
);

/** Deck ids are unique per user, not globally. */
export const decks = pgTable(
  'decks',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    id: text('id').notNull(),
    /** What the apps show for the deck, e.g. "Core vocabulary". */
    name: text('name').notNull(),
    language: text('language').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.id] })],
);

/**
 * Word ids are unique per user, across all of that user's decks. A word's `user_id` is always
 * its deck's: the foreign key covers both columns.
 */
export const words = pgTable(
  'words',
  {
    userId: text('user_id').notNull(),
    id: text('id').notNull(),
    deckId: text('deck_id').notNull(),
    /** Order of the word within its deck, as authored. */
    position: integer('position').notNull(),
    /** Null for a sentence card. */
    questionShort: text('question_short'),
    /** Null for a sentence card. */
    answerShort: text('answer_short'),
    questionExample: text('question_example').notNull().default(''),
    answerExample: text('answer_example').notNull().default(''),
    /** Times the card has been shown, and how many of those were answered right or wrong. */
    showsCount: integer('shows_count').notNull().default(0),
    successesCount: integer('successes_count').notNull().default(0),
    failuresCount: integer('failures_count').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    // Cascades on update too, so moving a deck to another user (`db:claim`) moves its words.
    foreignKey({
      columns: [table.userId, table.deckId],
      foreignColumns: [decks.userId, decks.id],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),
    index('words_user_deck_position_idx').on(table.userId, table.deckId, table.position),
  ],
);

export type User = typeof users.$inferSelect;
export type Deck = typeof decks.$inferSelect;
export type Word = typeof words.$inferSelect;
export type NewWord = typeof words.$inferInsert;
