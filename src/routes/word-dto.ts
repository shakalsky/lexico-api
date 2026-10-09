import type { Word } from '../db/schema.js';

/**
 * Wire format the Flutter app's `WordDto` and lexico-web read. Registered in `app.ts`;
 * routes refer to it as `WordDto#`.
 */
export const wordDtoSchema = {
  $id: 'WordDto',
  type: 'object',
  required: [
    'id',
    'question_short',
    'answer_short',
    'question_example',
    'answer_example',
    'shows_count',
    'successes_count',
    'failures_count',
  ],
  properties: {
    id: { type: 'string' },
    question_short: {
      type: ['string', 'null'],
      description: 'Null for a sentence card: show `question_example` in its place.',
    },
    answer_short: { type: ['string', 'null'], description: 'Null when not given.' },
    question_example: { type: 'string', description: 'Sentence in the language being learned.' },
    answer_example: { type: 'string', description: 'Translation of `question_example`.' },
    shows_count: { type: 'integer', minimum: 0, description: 'Times the card was answered.' },
    successes_count: { type: 'integer', minimum: 0, description: 'Answered correctly.' },
    failures_count: { type: 'integer', minimum: 0, description: 'Answered incorrectly.' },
  },
} as const;

export function toWordDto(word: Word) {
  return {
    id: word.id,
    question_short: word.questionShort,
    answer_short: word.answerShort,
    question_example: word.questionExample,
    answer_example: word.answerExample,
    shows_count: word.showsCount,
    successes_count: word.successesCount,
    failures_count: word.failuresCount,
  };
}
