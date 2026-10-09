import type { Deck } from '../db/schema.js';

/** Registered in `app.ts`; routes refer to it as `DeckDto#`. */
export const deckDtoSchema = {
  $id: 'DeckDto',
  type: 'object',
  required: ['id', 'name', 'language', 'created_at'],
  properties: {
    id: { type: 'string' },
    name: { type: 'string', description: 'Shown to the learner, e.g. "Food".' },
    language: { type: 'string', description: 'Display label, e.g. "Español"; not a language code.' },
    created_at: { type: 'string', description: 'ISO 8601 in UTC with milliseconds.' },
  },
} as const;

export function toDeckDto(deck: Deck) {
  return {
    id: deck.id,
    name: deck.name,
    language: deck.language,
    created_at: deck.createdAt.toISOString(),
  };
}
