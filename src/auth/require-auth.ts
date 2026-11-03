import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/client.js';
import { errorResponse } from '../routes/errors.js';
import { authenticate } from './sessions.js';

const unauthorized = errorResponse(
  '`unauthorized`: no `Authorization: Bearer <token>` header, or the token is invalid, expired ' +
    'or logged out.',
);

/**
 * Requires a valid token on every route registered in `app`'s scope (call it before
 * registering them), sets `request.userId`, and marks the routes in the OpenAPI document.
 */
export function requireAuth(app: FastifyInstance, db: Db) {
  app.decorateRequest('userId', '');
  app.decorateRequest('sessionTokenHash', '');
  app.addHook('onRequest', authenticate(db));
  app.addHook('onRoute', (route) => {
    const schema = (route.schema ??= {}) as { security?: unknown; response?: Record<string, unknown> };
    schema.security = [{ bearerAuth: [] }];
    schema.response = { ...schema.response, 401: unauthorized };
  });
}
