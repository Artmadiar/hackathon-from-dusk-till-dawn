import fastifyCookie from '@fastify/cookie';
import { clockFromEnv, createApp, uuidIdGen } from '@fdtd/shared';
import { AuthService } from './auth/service.js';
import { registerAuthRoutes } from './auth/routes.js';
import { registerAdminRoutes } from './http/admin-routes.js';
import { registerMcpRoutes } from './mcp/server.js';
import { registerStripeRoutes } from './stripe/routes.js';
import { DEMO_USER_PROFILE } from './registry/seed.js';
import { createDb } from './db/client.js';
import { migrate } from './db/migrate.js';
import { AgentDispatcher } from './dispatcher/dispatcher.js';
import { DealService } from './deals/deal-service.js';
import { EventsQuery } from './events/query.js';
import { registerEventRoutes } from './events/routes.js';
import { PgEventWriter } from './events/writer.js';
import { registerAgentRoutes } from './http/agent-routes.js';
import { registerPublicRoutes } from './http/public-routes.js';
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
const jwtSecret = process.env.AGENT_JWT_SECRET ?? 'dev-agent-secret';
const dispatcher = new AgentDispatcher({
  clock, events,
  jwtSecret,
  buyerAgentUrl: process.env.BUYER_AGENT_URL ?? 'http://buyer-agent:3381',
});
const dealService = new DealService({
  db, events, clock, idGen: uuidIdGen, policy, registry, gateway: dispatcher,
});
const auth = new AuthService(db, clock);
const app = createApp({ service: 'platform' });
await app.register(fastifyCookie);
const eventsQuery = new EventsQuery(db);
registerEventRoutes(app, { eventsQuery, auth });
registerAgentRoutes(app, { db, deals: dealService, registry, policy, dispatcher, events, clock, jwtSecret });
registerPublicRoutes(app, { db, deals: dealService, ledger, registry, policy, dispatcher, events, clock, auth });
registerAuthRoutes(app, { auth });
registerAdminRoutes(app, { eventsQuery, auth });
registerStripeRoutes(app, {
  ledger, auth,
  secretKey: process.env.STRIPE_SECRET_KEY || undefined,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || undefined,
  webUrl: process.env.WEB_URL || 'http://localhost:3387',
});
registerMcpRoutes(app, {
  db, auth, deals: dealService, dispatcher,
  fallbackDeliveryAddress: DEMO_USER_PROFILE.deliveryAddress,
});
if (applied.length) app.log.info({ applied }, 'migrations applied');

const port = Number(process.env.PORT ?? 3380);
await app.listen({ port, host: '0.0.0.0' });
