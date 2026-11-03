/**
 * Moves the decks that existed before accounts (owned by the placeholder `legacy` user) into
 * a real account, with their words and counters:
 *
 *   npm run db:claim -- you@example.com
 *
 * Register the account first. Stops without changing anything if the account already has a
 * deck or word with the same id as one being moved.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { db } from './client.js';
import { decks, LEGACY_USER_ID, users, words } from './schema.js';

async function claim(email: string) {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (!user) throw new Error(`No account "${email}". Register it first (POST /auth/register).`);
  if (user.id === LEGACY_USER_ID) throw new Error('That is the placeholder account itself.');

  await db.transaction(async (tx) => {
    const legacyDecks = await tx
      .select({ id: decks.id })
      .from(decks)
      .where(eq(decks.userId, LEGACY_USER_ID))
      .for('update');
    if (legacyDecks.length === 0) {
      console.log('No decks to claim.');
      return;
    }

    const deckIds = legacyDecks.map((deck) => deck.id);
    const takenDecks = await tx
      .select({ id: decks.id })
      .from(decks)
      .where(and(eq(decks.userId, user.id), inArray(decks.id, deckIds)));
    const legacyWordIds = tx
      .select({ id: words.id })
      .from(words)
      .where(eq(words.userId, LEGACY_USER_ID));
    const takenWords = await tx
      .select({ id: words.id })
      .from(words)
      .where(and(eq(words.userId, user.id), inArray(words.id, legacyWordIds)));
    if (takenDecks.length > 0 || takenWords.length > 0) {
      throw new Error(
        `"${email}" already has these ids. Delete or rename them, then rerun.\n` +
          `  decks: ${takenDecks.map((deck) => deck.id).join(', ') || '-'}\n` +
          `  words: ${takenWords.map((word) => word.id).join(', ') || '-'}`,
      );
    }

    // `words.user_id` follows through the foreign key's ON UPDATE CASCADE.
    await tx.update(decks).set({ userId: user.id }).where(eq(decks.userId, LEGACY_USER_ID));
    await tx.delete(users).where(eq(users.id, LEGACY_USER_ID));
    console.log(`Moved ${deckIds.length} deck(s) to "${email}": ${deckIds.join(', ')}.`);
  });
}

try {
  const email = process.argv[2]?.toLowerCase();
  if (!email) throw new Error('Usage: npm run db:claim -- <email of the account to move decks to>');
  await claim(email);
} finally {
  await db.$client.end();
}
