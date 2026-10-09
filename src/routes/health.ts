import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { Db } from '../db/client.js';

export const healthRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  app.get(
    '/health',
    {
      schema: {
        operationId: 'getHealth',
        tags: ['health'],
        summary: 'Liveness, including the database',
        response: {
          200: {
            description: 'The API and its database are up. `500 internal_error` otherwise.',
            type: 'object',
            required: ['status'],
            properties: { status: { type: 'string', const: 'ok' } },
          },
        },
      },
    },
    async () => {
      await db.execute(sql`select 1`);
      return { status: 'ok' };
    },
  );
};
