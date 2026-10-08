import type { FastifyInstance } from 'fastify';
import { createApp, systemClock, uuidIdGen, type Clock, type IdGen } from '@fdtd/shared';
import { StoreDb } from './db.js';
import type { StoreSeed } from './seed.js';
import { nextDeliveryEta } from './delivery.js';
import { createWebhookSender, type WebhookSender, type WebhookSenderOpts } from './webhook.js';
import { registerApi } from './api.js';
import { registerViews } from './views.js';

export interface StoreContext {
  seed: StoreSeed;
  db: StoreDb;
  clock: Clock;
  idGen: IdGen;
  webhook: WebhookSender;
  autoConfirm: boolean;
  nextEta: (now: Date) => string;
}

export interface CreateStoreOpts {
  seed: StoreSeed;
  webhook: Omit<WebhookSenderOpts, 'clock'>;
  dbFile?: string;
  clock?: Clock;
  idGen?: IdGen;
  /** Переопределить autoConfirm из seed (env AUTO_CONFIRM). */
  autoConfirm?: boolean;
}

export function createStore(opts: CreateStoreOpts): { app: FastifyInstance; ctx: StoreContext } {
  const clock = opts.clock ?? systemClock;
  const db = new StoreDb(opts.dbFile ?? ':memory:');
  db.applySeed(opts.seed);

  const app = createApp({
    service: `demo-store:${opts.seed.id}`,
    health: { store: opts.seed.id, name: opts.seed.name },
  });

  const ctx: StoreContext = {
    seed: opts.seed,
    db,
    clock,
    idGen: opts.idGen ?? uuidIdGen,
    webhook: createWebhookSender({ log: app.log, ...opts.webhook, clock }),
    autoConfirm: opts.autoConfirm ?? opts.seed.autoConfirm,
    nextEta: (now) => nextDeliveryEta(opts.seed.delivery, now),
  };

  app.addHook('onClose', async () => db.close());
  registerApi(app, ctx);
  registerViews(app, ctx);
  return { app, ctx };
}
