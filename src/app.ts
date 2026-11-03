import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import apiReference from '@scalar/fastify-api-reference';
import Fastify from 'fastify';
import { requireAuth } from './auth/require-auth.js';
import type { Db } from './db/client.js';
import { authRoutes } from './routes/auth.js';
import { deckDtoSchema } from './routes/deck-dto.js';
import { deckRoutes } from './routes/decks.js';
import { errorSchema } from './routes/errors.js';
import { healthRoutes } from './routes/health.js';
import { userDtoSchema } from './routes/user-dto.js';
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
  for (const schema of [deckDtoSchema, wordDtoSchema, userDtoSchema, errorSchema]) {
    app.addSchema(schema);
  }

  // Builds the OpenAPI document from the route schemas. Must be registered before the routes.
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Lexico API',
        version: '0.0.0',
        description:
          'HTTP API behind Léxico, a vocabulary flashcard app. Bearer-token authentication, ' +
          'JSON only, `snake_case` fields. `API.md` in the repo has the full reference.',
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            description: 'The `token` from `POST /auth/register` or `POST /auth/login`.',
          },
        },
      },
      // Routes that need a token say so themselves (see `requireAuth`).
      security: [],
      tags: [
        { name: 'auth', description: 'Accounts and sessions' },
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
  await app.register(authRoutes, { db });

  // Everything in here needs a token, and only sees the data of the token's user.
  await app.register(async (authed) => {
    requireAuth(authed, db);
    await authed.register(deckRoutes, { db });
    await authed.register(wordRoutes, { db });
  });

  return app;
}
