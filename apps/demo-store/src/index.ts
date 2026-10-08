import { fileURLToPath } from 'node:url';
import { clockFromEnv } from '@fdtd/shared';
import { loadSeed } from './seed.js';
import { createStore } from './app.js';

/** Экземпляр магазина: SEED выбирает каталог, WEBHOOK_URL/SECRET — агента (compose 3.3). */
const seedName = process.env.SEED ?? 'aqua';
const seed = loadSeed(fileURLToPath(new URL(`../seeds/${seedName}.json`, import.meta.url)));

const { app } = createStore({
  seed,
  clock: clockFromEnv(),
  webhook: {
    url: process.env.WEBHOOK_URL ?? 'http://localhost:9999/hooks/store',
    secret: process.env.WEBHOOK_SECRET ?? 'dev-webhook-secret',
  },
  dbFile: process.env.DB_FILE ?? ':memory:',
  autoConfirm: process.env.AUTO_CONFIRM ? process.env.AUTO_CONFIRM === 'true' : undefined,
});

const port = Number(process.env.PORT ?? 3390);
await app.listen({ port, host: '0.0.0.0' });
