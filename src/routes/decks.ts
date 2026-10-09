import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, max } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { Db } from '../db/client.js';
import { decks, words, type NewWord, type Word } from '../db/schema.js';
import { toDeckDto } from './deck-dto.js';
import { errorResponse } from './errors.js';
import { toWordDto } from './word-dto.js';
import { nonBlankString, quoteAll, wordFieldsSchema } from './word-input.js';

const wordListSchema = {
  type: 'object',
  required: ['words'],
  properties: { words: { type: 'array', items: { $ref: 'WordDto#' } } },
} as const;

const deckParamsSchema = {
  type: 'object',
  required: ['deckId'],
  properties: { deckId: { type: 'string', minLength: 1, description: 'URL-encoded deck id.' } },
} as const;

const deckNotFound = errorResponse('`deck_not_found`: no deck with this id.');

/** `id` is generated when omitted. */
const newDeckSchema = {
  type: 'object',
  required: ['name', 'language'],
  properties: {
    id: { type: 'string', minLength: 1, description: 'Generated (UUID v4) when omitted.' },
    name: nonBlankString,
    language: nonBlankString,
  },
} as const;

interface NewDeckInput {
  id?: string;
  name: string;
  language: string;
}

/**
 * Same shape as a word in `data/decks/*.json`. Only the example sentence and its
 * translation are required: a word without a `question_short` (omitted, null or
 * "") is studied as a whole sentence. `id` is generated when omitted.
 */
const newWordSchema = {
  type: 'object',
  required: ['question_example', 'answer_example'],
  properties: {
    id: { type: 'string', minLength: 1, description: 'Generated (UUID v4) when omitted.' },
    ...wordFieldsSchema,
  },
} as const;

interface NewWordInput {
  id?: string;
  question_short?: string | null;
  answer_short?: string | null;
  question_example: string;
  answer_example: string;
}

function findRepeated(values: string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}

/** Thrown inside the insert transaction so that it rolls back. */
class WordIdsTakenError extends Error {}

/** Thrown inside the insert transaction so that it rolls back. */
class QuestionExamplesTakenError extends Error {}

export const deckRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  app.get(
    '/decks',
    {
      schema: {
        operationId: 'listDecks',
        tags: ['decks'],
        summary: 'List all decks',
        description: 'Oldest first (by `created_at`, ties broken by `id`). No pagination.',
        response: {
          200: {
            description: 'Every deck.',
            type: 'object',
            required: ['decks'],
            properties: { decks: { type: 'array', items: { $ref: 'DeckDto#' } } },
          },
        },
      },
    },
    async () => {
      const rows = await db.select().from(decks).orderBy(asc(decks.createdAt), asc(decks.id));
      return { decks: rows.map(toDeckDto) };
    },
  );

  app.post<{ Body: NewDeckInput }>(
    '/decks',
    {
      schema: {
        operationId: 'createDeck',
        tags: ['decks'],
        summary: 'Create a deck',
        description: 'Creates an empty deck. `name` and `language` are stored as sent, not trimmed.',
        body: newDeckSchema,
        response: {
          201: {
            description: 'Created.',
            type: 'object',
            required: ['deck'],
            properties: { deck: { $ref: 'DeckDto#' } },
          },
          400: errorResponse('`FST_ERR_VALIDATION`: a field is missing, blank or of the wrong type.'),
          409: errorResponse('`deck_id_taken`: a deck with this `id` already exists.'),
        },
      },
    },
    async (request, reply) => {
      const { id = randomUUID(), name, language } = request.body;

      const [deck] = await db
        .insert(decks)
        .values({ id, name, language })
        .onConflictDoNothing({ target: decks.id })
        .returning();
      if (!deck) {
        return reply.code(409).send({ error: 'deck_id_taken', message: `Deck "${id}" already exists.` });
      }

      return reply.code(201).send({ deck: toDeckDto(deck) });
    },
  );

  // The foreign key on `words.deck_id` cascades, so the deck's words go with it.
  app.delete<{ Params: { deckId: string } }>(
    '/decks/:deckId',
    {
      schema: {
        operationId: 'deleteDeck',
        tags: ['decks'],
        summary: 'Delete a deck and its words',
        description: 'Deletes the deck and every word in it, in one statement. Cannot be undone.',
        params: deckParamsSchema,
        response: {
          204: { description: 'Deleted, along with its words. No body.', type: 'null' },
          404: deckNotFound,
        },
      },
    },
    async (request, reply) => {
      const { deckId } = request.params;

      const [deck] = await db.delete(decks).where(eq(decks.id, deckId)).returning({ id: decks.id });
      if (!deck) {
        return reply.code(404).send({ error: 'deck_not_found', message: `No deck "${deckId}".` });
      }

      return reply.code(204).send();
    },
  );

  app.get<{ Params: { deckId: string } }>(
    '/decks/:deckId/words',
    {
      schema: {
        operationId: 'listDeckWords',
        tags: ['words'],
        summary: 'List the words in a deck',
        description: 'Every word, in deck order (the order they were added in). No pagination.',
        params: deckParamsSchema,
        response: {
          200: { description: 'The deck’s words.', ...wordListSchema },
          404: deckNotFound,
        },
      },
    },
    async (request, reply) => {
      const { deckId } = request.params;

      const [deck] = await db
        .select({ id: decks.id })
        .from(decks)
        .where(eq(decks.id, deckId))
        .limit(1);
      if (!deck) {
        return reply.code(404).send({ error: 'deck_not_found', message: `No deck "${deckId}".` });
      }

      const rows = await db
        .select()
        .from(words)
        .where(eq(words.deckId, deckId))
        .orderBy(asc(words.position));

      return { words: rows.map(toWordDto) };
    },
  );

  // Adds words to the end of a deck, in request order. All or nothing.
  app.post<{ Params: { deckId: string }; Body: { words: NewWordInput[] } }>(
    '/decks/:deckId/words',
    {
      schema: {
        operationId: 'addDeckWords',
        tags: ['words'],
        summary: 'Append words to a deck',
        description:
          'Appends words to the end of the deck, in request order. All or nothing: if any word ' +
          'is rejected, none are added. Checks run in the order of the error statuses below.',
        params: deckParamsSchema,
        body: {
          type: 'object',
          required: ['words'],
          properties: {
            words: { type: 'array', minItems: 1, maxItems: 1000, items: newWordSchema },
          },
        },
        response: {
          201: {
            description: 'The created words, in request order, with their final ids.',
            ...wordListSchema,
          },
          400: errorResponse(
            '`FST_ERR_VALIDATION`: the body doesn’t match the schema; `duplicate_word_ids`: ' +
              'the same `id` appears twice in `words`; or `duplicate_question_examples`: the ' +
              'same `question_example` appears twice in `words`.',
          ),
          404: deckNotFound,
          409: errorResponse(
            '`question_examples_taken`: a `question_example` already belongs to a word in this ' +
              'deck; or `word_ids_taken`: an `id` already belongs to a word, in any deck.',
          ),
        },
      },
    },
    async (request, reply) => {
      const { deckId } = request.params;
      const input = request.body.words.map((word) => ({ ...word, id: word.id ?? randomUUID() }));

      const repeated = findRepeated(input.map((word) => word.id));
      if (repeated.length > 0) {
        return reply.code(400).send({
          error: 'duplicate_word_ids',
          message: `Word ids appear more than once: ${repeated.join(', ')}.`,
        });
      }

      const questionExamples = input.map((word) => word.question_example);
      const repeatedExamples = findRepeated(questionExamples);
      if (repeatedExamples.length > 0) {
        return reply.code(400).send({
          error: 'duplicate_question_examples',
          message: `Question examples appear more than once: ${quoteAll(repeatedExamples)}.`,
        });
      }

      let created: Word[] | null;
      try {
        created = await db.transaction(async (tx) => {
          // Locking the deck row stops concurrent adds from taking the same positions.
          const [deck] = await tx
            .select({ id: decks.id })
            .from(decks)
            .where(eq(decks.id, deckId))
            .for('update');
          if (!deck) return null;

          // Checked under the deck lock, so a concurrent add can't slip the same sentence in.
          const taken = await tx
            .select({ questionExample: words.questionExample })
            .from(words)
            .where(and(eq(words.deckId, deckId), inArray(words.questionExample, questionExamples)));
          if (taken.length > 0) {
            throw new QuestionExamplesTakenError(
              `Question examples already in this deck: ${quoteAll(taken.map((word) => word.questionExample))}.`,
            );
          }

          const [last] = await tx
            .select({ position: max(words.position) })
            .from(words)
            .where(eq(words.deckId, deckId));
          const start = (last?.position ?? -1) + 1;

          const rows: NewWord[] = input.map((word, index) => ({
            id: word.id,
            deckId,
            position: start + index,
            questionShort: word.question_short || null,
            answerShort: word.answer_short || null,
            questionExample: word.question_example,
            answerExample: word.answer_example,
          }));

          const inserted = await tx
            .insert(words)
            .values(rows)
            .onConflictDoNothing({ target: words.id })
            .returning();
          if (inserted.length < rows.length) {
            const insertedIds = new Set(inserted.map((word) => word.id));
            const taken = rows.map((row) => row.id).filter((id) => !insertedIds.has(id));
            throw new WordIdsTakenError(`Word ids already exist: ${taken.join(', ')}.`);
          }
          return inserted.sort((a, b) => a.position - b.position);
        });
      } catch (error) {
        if (error instanceof QuestionExamplesTakenError) {
          return reply.code(409).send({ error: 'question_examples_taken', message: error.message });
        }
        if (!(error instanceof WordIdsTakenError)) throw error;
        return reply.code(409).send({ error: 'word_ids_taken', message: error.message });
      }

      if (!created) {
        return reply.code(404).send({ error: 'deck_not_found', message: `No deck "${deckId}".` });
      }
      return reply.code(201).send({ words: created.map(toWordDto) });
    },
  );
};
