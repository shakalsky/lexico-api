import { and, eq, getTableColumns, ne, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { Db } from '../db/client.js';
import { decks, words, type NewWord, type Word } from '../db/schema.js';
import { errorResponse } from './errors.js';
import { toWordDto, wordListSchema } from './word-dto.js';
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

/** One answer to a card. */
const reviewSchema = {
  type: 'object',
  required: ['word_id', 'correct'],
  properties: {
    word_id: { type: 'string', minLength: 1 },
    correct: { type: 'boolean', description: 'true: answered right; false: answered wrong.' },
  },
} as const;

interface ReviewInput {
  word_id: string;
  correct: boolean;
}

/** The word with this id, among the user's words. */
function ownWord(userId: string, wordId: string) {
  return and(eq(words.userId, userId), eq(words.id, wordId));
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
      const { userId } = request;
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
              .where(ownWord(userId, wordId));
            if (!current) return undefined;

            // Locking the deck row, as adding words does, stops a concurrent add or edit
            // from taking the same sentence.
            await tx
              .select({ id: decks.id })
              .from(decks)
              .where(and(eq(decks.userId, userId), eq(decks.id, current.deckId)))
              .for('update');

            const [taken] = await tx
              .select({ id: words.id })
              .from(words)
              .where(
                and(
                  eq(words.userId, userId),
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

          const [word] = await tx
            .update(words)
            .set(changes)
            .where(ownWord(userId, wordId))
            .returning();
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

      const [word] = await db
        .delete(words)
        .where(ownWord(request.userId, wordId))
        .returning({ id: words.id });
      if (!word) {
        return reply.code(404).send({ error: 'word_not_found', message: `No word "${wordId}".` });
      }

      return reply.code(204).send();
    },
  );

  // Records a study session's answers: each counts the card as shown, and as a
  // success or a failure. Words that no longer exist are skipped.
  app.post<{ Body: { reviews: ReviewInput[] } }>(
    '/reviews',
    {
      schema: {
        operationId: 'recordReviews',
        tags: ['words'],
        summary: 'Record a session’s answers',
        description:
          'For each answer, adds 1 to the word’s `shows_count`, and 1 to `successes_count` or ' +
          '`failures_count`. A word may appear more than once. Answers to word ids that don’t ' +
          'exist, or belong to another user, are skipped. Not idempotent: every call counts, including retries.',
        body: {
          type: 'object',
          required: ['reviews'],
          properties: {
            reviews: { type: 'array', minItems: 1, maxItems: 1000, items: reviewSchema },
          },
        },
        response: {
          200: {
            description:
              'Counted. Each word that exists, once, in order of its first answer, with its new counts.',
            ...wordListSchema,
          },
          400: errorResponse('`FST_ERR_VALIDATION`: the body doesn’t match the schema.'),
        },
      },
    },
    async (request) => {
      const totals = new Map<string, { successes: number; failures: number }>();
      for (const { word_id, correct } of request.body.reviews) {
        const total = totals.get(word_id) ?? { successes: 0, failures: 0 };
        if (correct) total.successes += 1;
        else total.failures += 1;
        totals.set(word_id, total);
      }
      const rows = [...totals].map(([word_id, total]) => ({ word_id, ...total }));

      // One statement, so concurrent answers to the same card are all counted.
      const updated = await db
        .update(words)
        .set({
          showsCount: sql`${words.showsCount} + r.successes + r.failures`,
          successesCount: sql`${words.successesCount} + r.successes`,
          failuresCount: sql`${words.failuresCount} + r.failures`,
        })
        .from(
          sql`json_to_recordset(${JSON.stringify(rows)}::json) as r(word_id text, successes int, failures int)`,
        )
        .where(and(eq(words.userId, request.userId), sql`${words.id} = r.word_id`))
        .returning(getTableColumns(words));

      // Map keys keep insertion order, which is the order of each word's first answer.
      const order = new Map([...totals.keys()].map((id, index) => [id, index]));
      updated.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
      return { words: updated.map(toWordDto) };
    },
  );
};
