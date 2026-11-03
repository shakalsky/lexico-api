/**
 * Loads every deck in `data/decks/*.json` into one user's account:
 *
 *   npm run db:seed -- you@example.com
 *
 * Safe to re-run: decks and words are upserted, and words removed from a
 * file are deleted from its deck. Other users' decks are not touched.
 */
import { readdir, readFile } from 'node:fs/promises';
import { and, eq, notInArray, sql, type AnyColumn } from 'drizzle-orm';
import { db } from './client.js';
import { decks, users, words, type NewWord } from './schema.js';

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

function toNewWords(userId: string, deck: DeckFile): NewWord[] {
  return deck.words.map((word, position) => ({
    userId,
    id: word.id,
    deckId: deck.deck_id,
    position,
    questionShort: word.question_short || null,
    answerShort: word.answer_short || null,
    questionExample: word.question_example ?? '',
    answerExample: word.answer_example ?? '',
  }));
}

async function seedDeck(userId: string, file: string) {
  const deck = JSON.parse(await readFile(new URL(file, decksDir), 'utf8')) as DeckFile;
  const rows = toNewWords(userId, deck);
  const fields = { name: deck.name ?? deck.deck_id, language: deck.language };

  await db.transaction(async (tx) => {
    await tx
      .insert(decks)
      .values({ userId, id: deck.deck_id, ...fields })
      .onConflictDoUpdate({ target: [decks.userId, decks.id], set: fields });

    if (rows.length > 0) {
      await tx
        .insert(words)
        .values(rows)
        .onConflictDoUpdate({
          target: [words.userId, words.id],
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
    const ownDeckWords = and(eq(words.userId, userId), eq(words.deckId, deck.deck_id));
    await tx
      .delete(words)
      .where(
        keptIds.length > 0
          ? and(ownDeckWords, notInArray(words.id, keptIds))
          : ownDeckWords,
      );
  });

  console.log(`Seeded deck "${deck.deck_id}" with ${rows.length} words.`);
}

try {
  const email = process.argv[2]?.toLowerCase();
  if (!email) throw new Error('Usage: npm run db:seed -- <email of the account to load decks into>');
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (!user) throw new Error(`No account "${email}". Register it first (POST /auth/register).`);

  const files = (await readdir(decksDir)).filter((name) => name.endsWith('.json'));
  for (const file of files) {
    await seedDeck(user.id, file);
  }
} finally {
  await db.$client.end();
}
