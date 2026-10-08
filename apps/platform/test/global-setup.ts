import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { migrate } from '../src/db/migrate.js';
import { TEST_DATABASE_URL } from './helpers.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const ADMIN_URL = TEST_DATABASE_URL.replace(/\/[^/]+$/, '/platform');

async function canConnect(url: string): Promise<boolean> {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 1500 });
  try { await c.connect(); await c.end(); return true; } catch { return false; }
}

/** Плат-тесты поднимают db из compose сами (plan 3.5). */
export default async function globalSetup(): Promise<void> {
  if (!(await canConnect(ADMIN_URL))) {
    execSync('docker compose --profile core up -d db', { cwd: REPO_ROOT, stdio: 'inherit' });
    const deadline = Date.now() + 60000;
    while (!(await canConnect(ADMIN_URL))) {
      if (Date.now() > deadline) throw new Error('postgres (compose db) did not become ready in 60s');
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // platform_test может отсутствовать, если volume создан до db/init
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = 'platform_test'");
  if (!rowCount) await admin.query('CREATE DATABASE platform_test');
  await admin.end();

  await migrate(TEST_DATABASE_URL);
}
