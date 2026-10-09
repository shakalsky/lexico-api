/** Text that has at least one non-space character. */
export const nonBlankString = { type: 'string', pattern: '\\S' } as const;

/** The editable fields of a word, shared by the add and edit requests. */
export const wordFieldsSchema = {
  question_short: {
    type: ['string', 'null'],
    description: 'Null or "" makes a sentence card.',
  },
  answer_short: { type: ['string', 'null'], description: '"" is stored as null.' },
  question_example: nonBlankString,
  answer_example: nonBlankString,
} as const;

/** Quotes sentences for an error message, since they may contain commas. */
export function quoteAll(sentences: string[]): string {
  return sentences.map((sentence) => JSON.stringify(sentence)).join(', ');
}
