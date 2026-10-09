import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const decks = pgTable('decks', {
  id: text('id').primaryKey(),
  /** What the apps show for the deck, e.g. "Core vocabulary". */
  name: text('name').notNull(),
  language: text('language').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const words = pgTable(
  'words',
  {
    id: text('id').primaryKey(),
    deckId: text('deck_id')
      .notNull()
      .references(() => decks.id, { onDelete: 'cascade' }),
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
  (table) => [index('words_deck_position_idx').on(table.deckId, table.position)],
);

export type Deck = typeof decks.$inferSelect;
export type Word = typeof words.$inferSelect;
export type NewWord = typeof words.$inferInsert;
