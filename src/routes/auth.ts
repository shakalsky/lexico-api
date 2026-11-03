import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { DUMMY_HASH, hashPassword, verifyPassword } from '../auth/password.js';
import { requireAuth } from '../auth/require-auth.js';
import { createSession } from '../auth/sessions.js';
import type { Db } from '../db/client.js';
import { sessions, users } from '../db/schema.js';
import { errorResponse } from './errors.js';
import { toUserDto } from './user-dto.js';

const credentialsSchema = {
  type: 'object',
  required: ['email', 'password'],
  properties: {
    email: {
      type: 'string',
      maxLength: 254,
      pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',
      description: 'Case-insensitive: stored lowercased.',
    },
    password: { type: 'string', minLength: 8, maxLength: 256 },
  },
} as const;

interface CredentialsInput {
  email: string;
  password: string;
}

/** `{ user, token, expires_at }`, returned by register and login. */
const sessionResponseSchema = {
  type: 'object',
  required: ['user', 'token', 'expires_at'],
  properties: {
    user: { $ref: 'UserDto#' },
    token: { type: 'string', description: 'Send as `Authorization: Bearer <token>`.' },
    expires_at: { type: 'string', description: 'ISO 8601 in UTC. Log in again after this.' },
  },
} as const;

export const authRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  app.post<{ Body: CredentialsInput }>(
    '/auth/register',
    {
      schema: {
        operationId: 'register',
        tags: ['auth'],
        summary: 'Create an account',
        description: 'Creates an account and logs it in: the response has a token, as for login.',
        security: [],
        body: credentialsSchema,
        response: {
          201: { description: 'Created and logged in.', ...sessionResponseSchema },
          400: errorResponse(
            '`FST_ERR_VALIDATION`: `email` isn’t an email address, or `password` is under 8 or ' +
              'over 256 characters.',
          ),
          409: errorResponse('`email_taken`: an account with this email already exists.'),
        },
      },
    },
    async (request, reply) => {
      const email = request.body.email.toLowerCase();
      const passwordHash = await hashPassword(request.body.password);

      const [user] = await db
        .insert(users)
        .values({ id: randomUUID(), email, passwordHash })
        .onConflictDoNothing({ target: users.email })
        .returning();
      if (!user) {
        return reply
          .code(409)
          .send({ error: 'email_taken', message: 'An account with this email already exists.' });
      }

      const session = await createSession(db, user.id);
      return reply.code(201).send({ user: toUserDto(user), ...session });
    },
  );

  app.post<{ Body: CredentialsInput }>(
    '/auth/login',
    {
      schema: {
        operationId: 'login',
        tags: ['auth'],
        summary: 'Log in',
        description: 'Returns a new token. Each login is a separate session; older tokens keep working.',
        security: [],
        body: credentialsSchema,
        response: {
          200: { description: 'Logged in.', ...sessionResponseSchema },
          400: errorResponse('`FST_ERR_VALIDATION`: the body doesn’t match the schema.'),
          401: errorResponse('`invalid_credentials`: wrong email or password.'),
        },
      },
    },
    async (request, reply) => {
      const email = request.body.email.toLowerCase();
      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

      // Hash even when there is no such account, so the response time doesn't reveal it.
      const valid = await verifyPassword(request.body.password, user?.passwordHash ?? DUMMY_HASH);
      if (!user?.passwordHash || !valid) {
        return reply
          .code(401)
          .send({ error: 'invalid_credentials', message: 'Wrong email or password.' });
      }

      const session = await createSession(db, user.id);
      return { user: toUserDto(user), ...session };
    },
  );

  await app.register(async (authed) => {
    requireAuth(authed, db);

    authed.get(
      '/auth/me',
      {
        schema: {
          operationId: 'getCurrentUser',
          tags: ['auth'],
          summary: 'The logged-in user',
          response: {
            200: {
              description: 'The account the token belongs to.',
              type: 'object',
              required: ['user'],
              properties: { user: { $ref: 'UserDto#' } },
            },
          },
        },
      },
      async (request) => {
        const [user] = await db.select().from(users).where(eq(users.id, request.userId)).limit(1);
        // The session cascades with the user, so a valid token always has one.
        return { user: toUserDto(user!) };
      },
    );

    authed.post(
      '/auth/logout',
      {
        schema: {
          operationId: 'logout',
          tags: ['auth'],
          summary: 'Log out',
          description: 'Ends this token’s session. Other sessions of the account keep working.',
          response: { 204: { description: 'Logged out. No body.', type: 'null' } },
        },
      },
      async (request, reply) => {
        await db.delete(sessions).where(eq(sessions.tokenHash, request.sessionTokenHash));
        return reply.code(204).send();
      },
    );
  });
};
