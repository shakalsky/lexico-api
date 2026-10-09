import { buildApp } from './app.js';
import { config } from './config.js';
import { db } from './db/client.js';

const app = await buildApp({ db, corsOrigins: config.corsOrigins });

async function shutdown() {
  await app.close();
  await db.$client.end();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void shutdown());
}

await app.listen({ port: config.port, host: config.host });
