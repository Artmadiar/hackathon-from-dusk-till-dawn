import { clockFromEnv, createApp, uuidIdGen } from '@fdtd/shared';
import { createDb } from './db/client.js';
import { migrate } from './db/migrate.js';
import { AgentDispatcher } from './dispatcher/dispatcher.js';
import { DealService } from './deals/deal-service.js';
import { EventsQuery } from './events/query.js';
import { registerEventRoutes } from './events/routes.js';
import { PgEventWriter } from './events/writer.js';
import { LedgerService } from './ledger/ledger.js';
import { PolicyService } from './policy/policy.js';
import { RegistryService } from './registry/registry.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const applied = await migrate(databaseUrl);

const { db } = createDb(databaseUrl);
const clock = clockFromEnv();
const events = new PgEventWriter(db, clock);
const policy = new PolicyService(db);
const ledger = new LedgerService(db, events, clock);
const registry = new RegistryService(db, events, clock);
const dispatcher = new AgentDispatcher({
  clock, events,
  jwtSecret: process.env.AGENT_JWT_SECRET ?? 'dev-agent-secret',
  buyerAgentUrl: process.env.BUYER_AGENT_URL ?? 'http://buyer-agent:3381',
});
const dealService = new DealService({
  db, events, clock, idGen: uuidIdGen, policy, registry, gateway: dispatcher,
});
void ledger; void dealService; // HTTP API поверх сервисов — S7/S8

const app = createApp({ service: 'platform' });
registerEventRoutes(app, { eventsQuery: new EventsQuery(db) });
if (applied.length) app.log.info({ applied }, 'migrations applied');

const port = Number(process.env.PORT ?? 3380);
await app.listen({ port, host: '0.0.0.0' });
