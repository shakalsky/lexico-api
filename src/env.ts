import { existsSync } from 'node:fs';

const appEnvs = ['development', 'staging'] as const;

export type AppEnv = (typeof appEnvs)[number];

/**
 * Reads `APP_ENV` (default `development`) and loads `.env.<APP_ENV>`. Variables already
 * set in the shell take precedence over the file.
 */
export function loadEnv(): AppEnv {
  const appEnv = process.env.APP_ENV ?? 'development';
  if (!appEnvs.includes(appEnv as AppEnv)) {
    throw new Error(`Unknown APP_ENV "${appEnv}". Expected one of: ${appEnvs.join(', ')}.`);
  }

  const file = `.env.${appEnv}`;
  if (existsSync(file)) process.loadEnvFile(file);
  return appEnv as AppEnv;
}
