/**
 * Loads every deck in `data/decks/*.json` into the database.
 *
 * Safe to re-run: decks and words are upserted, and words removed from a
 * file are deleted from its deck.
 */
import { readdir, readFile } from 'node:fs/promises';
import { and, eq, notInArray, sql, type AnyColumn } from 'drizzle-orm';
import { db } from './client.js';
import { decks, words, type NewWord } from './schema.js';

const decksDir = new URL('../../data/decks/', import.meta.url);

interface DeckFile {
  deck_id: string;
  /** Defaults to `deck_id`. */
  name?: string;
  language: string;
  words: {
    id: string;
    question_short?: string | null;
    answer_short?: string | null;
    question_example?: string;
    answer_example?: string;
  }[];
}

/** The value Postgres would have inserted, for `ON CONFLICT DO UPDATE`. */
const excluded = (column: AnyColumn) => sql.raw(`excluded.${column.name}`);

function toNewWords(deck: DeckFile): NewWord[] {
  return deck.words.map((word, position) => ({
    id: word.id,
    deckId: deck.deck_id,
    position,
    questionShort: word.question_short || null,
    answerShort: word.answer_short || null,
    questionExample: word.question_example ?? '',
    answerExample: word.answer_example ?? '',
  }));
}

async function seedDeck(file: string) {
  const deck = JSON.parse(await readFile(new URL(file, decksDir), 'utf8')) as DeckFile;
  const rows = toNewWords(deck);
  const fields = { name: deck.name ?? deck.deck_id, language: deck.language };

  await db.transaction(async (tx) => {
    await tx
      .insert(decks)
      .values({ id: deck.deck_id, ...fields })
      .onConflictDoUpdate({ target: decks.id, set: fields });

    if (rows.length > 0) {
      await tx
        .insert(words)
        .values(rows)
        .onConflictDoUpdate({
          target: words.id,
          set: {
            deckId: excluded(words.deckId),
            position: excluded(words.position),
            questionShort: excluded(words.questionShort),
            answerShort: excluded(words.answerShort),
            questionExample: excluded(words.questionExample),
            answerExample: excluded(words.answerExample),
          },
        });
    }

    const keptIds = rows.map((row) => row.id);
    await tx
      .delete(words)
      .where(
        keptIds.length > 0
          ? and(eq(words.deckId, deck.deck_id), notInArray(words.id, keptIds))
          : eq(words.deckId, deck.deck_id),
      );
  });

  console.log(`Seeded deck "${deck.deck_id}" with ${rows.length} words.`);
}

try {
  const files = (await readdir(decksDir)).filter((name) => name.endsWith('.json'));
  for (const file of files) {
    await seedDeck(file);
  }
} finally {
  await db.$client.end();
}
