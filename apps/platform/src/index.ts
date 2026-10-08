import { createApp } from '@fdtd/shared';
import { migrate } from './db/migrate.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const applied = await migrate(databaseUrl);

const app = createApp({ service: 'platform' });
if (applied.length) app.log.info({ applied }, 'migrations applied');
const port = Number(process.env.PORT ?? 3380);
await app.listen({ port, host: '0.0.0.0' });
