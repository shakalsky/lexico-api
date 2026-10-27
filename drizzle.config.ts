import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

// Same lookup as `loadEnv` in src/env.ts.
const envFile = `.env.${process.env.APP_ENV ?? 'development'}`;
if (existsSync(envFile)) process.loadEnvFile(envFile);

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
});
