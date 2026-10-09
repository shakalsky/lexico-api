import { drizzle } from 'drizzle-orm/node-postgres';
import { config } from '../config.js';
import * as schema from './schema.js';

export const db = drizzle(config.databaseUrl, { schema });

export type Db = typeof db;
