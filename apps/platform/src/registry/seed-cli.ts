import { clockFromEnv } from '@fdtd/shared';
import { createDb } from '../db/client.js';
import { migrate } from '../db/migrate.js';
import { PgEventWriter } from '../events/writer.js';
import { seedDemo } from './seed.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
await migrate(url);
const { db, pool } = createDb(url);
const clock = clockFromEnv();
await seedDemo({ db, events: new PgEventWriter(db, clock), clock });
console.log('demo data seeded: buyer-1 + 4 providers, ledger/journal wiped');
await pool.end();
