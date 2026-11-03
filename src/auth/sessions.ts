import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, lte } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/client.js';
import { sessions } from '../db/schema.js';

/** How long a token works after login or registration. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `authenticate` on routes that require a token. */
    userId: string;
    /** Hash of the bearer token, for logout. */
    sessionTokenHash: string;
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Creates a session and returns its token, which is only ever shown here. */
export async function createSession(db: Db, userId: string) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.transaction(async (tx) => {
    // Housekeeping: drop this user's expired sessions.
    await tx
      .delete(sessions)
      .where(and(eq(sessions.userId, userId), lte(sessions.expiresAt, new Date())));
    await tx.insert(sessions).values({ tokenHash: hashToken(token), userId, expiresAt });
  });

  return { token, expires_at: expiresAt.toISOString() };
}

function bearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  const match = header?.match(/^Bearer\s+(\S+)\s*$/i);
  return match?.[1];
}

/** `onRequest` hook: rejects the request with 401 unless it has a valid, unexpired token. */
export function authenticate(db: Db) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const token = bearerToken(request);
    if (!token) {
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'Send a token in the Authorization header: "Bearer <token>".',
      });
    }

    const tokenHash = hashToken(token);
    const [session] = await db
      .select({ userId: sessions.userId })
      .from(sessions)
      .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date())))
      .limit(1);
    if (!session) {
      return reply
        .code(401)
        .send({ error: 'unauthorized', message: 'The token is invalid, expired or logged out.' });
    }

    request.userId = session.userId;
    request.sessionTokenHash = tokenHash;
  };
}
