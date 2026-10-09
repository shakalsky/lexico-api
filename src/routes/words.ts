import { and, eq, ne, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { Db } from '../db/client.js';
import { decks, words, type NewWord, type Word } from '../db/schema.js';
import { errorResponse } from './errors.js';
import { toWordDto } from './word-dto.js';
import { quoteAll, wordFieldsSchema } from './word-input.js';

const wordParamsSchema = {
  type: 'object',
  required: ['wordId'],
  properties: { wordId: { type: 'string', minLength: 1, description: 'URL-encoded word id.' } },
} as const;

const wordNotFound = errorResponse('`word_not_found`: no word with this id.');

/** Any of the editable fields; at least one. Omitted fields keep their value. */
const wordEditSchema = {
  type: 'object',
  properties: wordFieldsSchema,
  anyOf: Object.keys(wordFieldsSchema).map((field) => ({ required: [field] })),
} as const;

interface WordEditInput {
  question_short?: string | null;
  answer_short?: string | null;
  question_example?: string;
  answer_example?: string;
}

/** Thrown inside the edit transaction so that it rolls back. */
class QuestionExampleTakenError extends Error {}

export const wordRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  app.patch<{ Params: { wordId: string }; Body: WordEditInput }>(
    '/words/:wordId',
    {
      schema: {
        operationId: 'editWord',
        tags: ['words'],
        summary: 'Edit a word',
        description:
          'Changes the fields sent and keeps the rest. The id, deck, position and counters ' +
          'can’t be changed. Checks run in the order of the error statuses below.',
        params: wordParamsSchema,
        body: wordEditSchema,
        response: {
          200: {
            description: 'Edited. `word` has the new values.',
            type: 'object',
            required: ['word'],
            properties: { word: { $ref: 'WordDto#' } },
          },
          400: errorResponse(
            '`FST_ERR_VALIDATION`: no editable field was sent, or a field is blank or of the ' +
              'wrong type.',
          ),
          404: wordNotFound,
          409: errorResponse(
            '`question_example_taken`: another word in this deck has this `question_example`.',
          ),
        },
      },
    },
    async (request, reply) => {
      const { wordId } = request.params;
      const body = request.body;

      const changes: Partial<NewWord> = {};
      if (body.question_short !== undefined) changes.questionShort = body.question_short || null;
      if (body.answer_short !== undefined) changes.answerShort = body.answer_short || null;
      if (body.question_example !== undefined) changes.questionExample = body.question_example;
      if (body.answer_example !== undefined) changes.answerExample = body.answer_example;

      let edited: Word | undefined;
      try {
        edited = await db.transaction(async (tx) => {
          const questionExample = changes.questionExample;
          if (questionExample !== undefined) {
            const [current] = await tx
              .select({ deckId: words.deckId })
              .from(words)
              .where(eq(words.id, wordId));
            if (!current) return undefined;

            // Locking the deck row, as adding words does, stops a concurrent add or edit
            // from taking the same sentence.
            await tx
              .select({ id: decks.id })
              .from(decks)
              .where(eq(decks.id, current.deckId))
              .for('update');

            const [taken] = await tx
              .select({ id: words.id })
              .from(words)
              .where(
                and(
                  eq(words.deckId, current.deckId),
                  eq(words.questionExample, questionExample),
                  ne(words.id, wordId),
                ),
              )
              .limit(1);
            if (taken) {
              throw new QuestionExampleTakenError(
                `Question example already in this deck: ${quoteAll([questionExample])}.`,
              );
            }
          }

          const [word] = await tx.update(words).set(changes).where(eq(words.id, wordId)).returning();
          return word;
        });
      } catch (error) {
        if (!(error instanceof QuestionExampleTakenError)) throw error;
        return reply.code(409).send({ error: 'question_example_taken', message: error.message });
      }

      if (!edited) {
        return reply.code(404).send({ error: 'word_not_found', message: `No word "${wordId}".` });
      }
      return { word: toWordDto(edited) };
    },
  );

  // Leaves a gap in the deck's positions, which is harmless: order is all that matters.
  app.delete<{ Params: { wordId: string } }>(
    '/words/:wordId',
    {
      schema: {
        operationId: 'deleteWord',
        tags: ['words'],
        summary: 'Delete a word',
        description: 'Deletes the word and its counters. The other words keep their order.',
        params: wordParamsSchema,
        response: {
          204: { description: 'Deleted. No body.', type: 'null' },
          404: wordNotFound,
        },
      },
    },
    async (request, reply) => {
      const { wordId } = request.params;

      const [word] = await db.delete(words).where(eq(words.id, wordId)).returning({ id: words.id });
      if (!word) {
        return reply.code(404).send({ error: 'word_not_found', message: `No word "${wordId}".` });
      }

      return reply.code(204).send();
    },
  );

  // Records one answer to a card: counts it as shown, and as a success or a failure.
  app.post<{ Params: { wordId: string }; Body: { correct: boolean } }>(
    '/words/:wordId/reviews',
    {
      schema: {
        operationId: 'recordReview',
        tags: ['words'],
        summary: 'Record one answer to a card',
        description:
          'Adds 1 to `shows_count`, and 1 to `successes_count` or `failures_count`. ' +
          'Not idempotent: every call counts, including retries.',
        params: wordParamsSchema,
        body: {
          type: 'object',
          required: ['correct'],
          properties: {
            correct: { type: 'boolean', description: 'true: answered right; false: answered wrong.' },
          },
        },
        response: {
          200: {
            description: 'Counted. `word` has the new counts.',
            type: 'object',
            required: ['word'],
            properties: { word: { $ref: 'WordDto#' } },
          },
          400: errorResponse('`FST_ERR_VALIDATION`: `correct` is missing or not a boolean.'),
          404: wordNotFound,
        },
      },
    },
    async (request, reply) => {
      const { wordId } = request.params;
      const outcome = request.body.correct
        ? { successesCount: sql`${words.successesCount} + 1` }
        : { failuresCount: sql`${words.failuresCount} + 1` };

      // One statement, so concurrent answers to the same card are all counted.
      const [word] = await db
        .update(words)
        .set({ showsCount: sql`${words.showsCount} + 1`, ...outcome })
        .where(eq(words.id, wordId))
        .returning();
      if (!word) {
        return reply.code(404).send({ error: 'word_not_found', message: `No word "${wordId}".` });
      }

      return { word: toWordDto(word) };
    },
  );
};
