/**
 * Every error body. Route handlers send `error` and `message`; Fastify's own request errors
 * (e.g. FST_ERR_VALIDATION) also send `statusCode` and `code`. Fastify serializes errors with
 * this schema too, so it must list every field of both shapes: any other field is dropped.
 * Registered in `app.ts`.
 */
export const errorSchema = {
  $id: 'Error',
  type: 'object',
  required: ['message'],
  properties: {
    statusCode: { type: 'integer' },
    code: { type: 'string', description: 'Fastify request errors only, e.g. "FST_ERR_VALIDATION".' },
    error: { type: 'string', description: 'API error code, e.g. "deck_not_found".' },
    message: { type: 'string', description: 'For developers, not end users.' },
  },
} as const;

/** A response schema for an error status, e.g. `404: errorResponse('deck_not_found: …')`. */
export function errorResponse(description: string) {
  return { description, $ref: 'Error#' };
}
