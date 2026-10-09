import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import apiReference from '@scalar/fastify-api-reference';
import Fastify from 'fastify';
import type { Db } from './db/client.js';
import { deckDtoSchema } from './routes/deck-dto.js';
import { deckRoutes } from './routes/decks.js';
import { errorSchema } from './routes/errors.js';
import { healthRoutes } from './routes/health.js';
import { wordDtoSchema } from './routes/word-dto.js';
import { wordRoutes } from './routes/words.js';

interface AppOptions {
  db: Db;
  corsOrigins: string[];
}

export async function buildApp({ db, corsOrigins }: AppOptions) {
  const app = Fastify({ logger: true });

  // Keep internals (e.g. failed SQL) in the log, not in the response.
  app.setErrorHandler((error: { statusCode?: number }, request, reply) => {
    const statusCode = error.statusCode ?? 500;
    if (statusCode < 500) return reply.send(error);
    request.log.error(error);
    return reply.code(statusCode).send({ error: 'internal_error', message: 'Something went wrong.' });
  });

  await app.register(cors, { origin: corsOrigins, methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'] });

  // Shared schemas, referenced from routes as e.g. `{ $ref: 'WordDto#' }`. They appear in the
  // OpenAPI document under their `$id`.
  for (const schema of [deckDtoSchema, wordDtoSchema, errorSchema]) app.addSchema(schema);

  // Builds the OpenAPI document from the route schemas. Must be registered before the routes.
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Lexico API',
        version: '0.0.0',
        description:
          'HTTP API behind Léxico, a vocabulary flashcard app. No authentication, JSON only, ' +
          '`snake_case` fields. `API.md` in the repo has the full reference.',
      },
      // No authentication.
      security: [],
      tags: [
        { name: 'decks', description: 'Decks of flashcards' },
        { name: 'words', description: 'Words (cards) in a deck, and answers to them' },
        { name: 'health', description: 'Liveness' },
      ],
    },
    refResolver: { buildLocalReference: (json, _baseUri, _fragment, i) => String(json.$id ?? `def-${i}`) },
  });
  // Interactive docs at /docs; the document itself at /docs/openapi.json and /docs/openapi.yaml.
  await app.register(apiReference, { routePrefix: '/docs' });

  await app.register(healthRoutes, { db });
  await app.register(deckRoutes, { db });
  await app.register(wordRoutes, { db });

  return app;
}
