import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Quote, Req } from '@fdtd/contracts';
import { createApp, verifyJwt, type Clock, type IdGen, type Llm } from '@fdtd/shared';
import type { AgentRules } from './config.js';
import { cancelDeal, handleStoreWebhook, NonceGuard, startFulfil, type FulfilDeps } from './fulfil.js';
import type { PlatformPort, StoreClient } from './ports.js';
import { makeQuote } from './quote.js';
import { DealBook } from './state.js';

export interface ProviderAgentDeps {
  providerId: string;
  rules: AgentRules;
  llm: Llm;
  store: StoreClient;
  platform: PlatformPort;
  clock: Clock;
  idGen: IdGen;
  /** Платформа -> агент: JWT (B8). */
  jwtSecret: string;
  /** Магазин -> агент: HMAC webhook (K7). */
  webhookSecret: string;
}

const QuoteBody = z.object({ taskId: z.string().min(1), request: Req });
const FulfilBody = z.object({ dealId: z.string().min(1), taskId: z.string().min(1), quote: Quote, request: Req });
const CancelBody = z.object({ dealId: z.string().min(1), reason: z.string().default('cancelled') });

export function createProviderAgent(deps: ProviderAgentDeps): { app: FastifyInstance; book: DealBook } {
  const app = createApp({
    service: `provider-agent:${deps.providerId}`,
    health: { providerId: deps.providerId },
  });
  /* тело приходит строкой: webhook проверяет HMAC по сырым байтам (C24) */
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));

  const book = new DealBook();
  const fulfilDeps: FulfilDeps & { llm: Llm; nonces: NonceGuard } = {
    ...deps, book, log: app.log, nonces: new NonceGuard(),
  };

  /* U6: карточка агента в духе A2A — кто я, что умею, как со мной авторизоваться */
  app.get('/.well-known/agent.json', async () => ({
    protocolVersion: 'a2a-inspired/0.1',
    id: deps.providerId,
    name: `provider-agent:${deps.providerId}`,
    description: 'Procurement provider agent: quotes and fulfils office-supplies orders for its store',
    contractTypes: ['office-supplies.v1'],
    endpoints: { quote: 'POST /quote', fulfil: 'POST /fulfil', cancel: 'POST /cancel' },
    auth: { scheme: 'jwt-hs256', iss: 'platform', aud: 'provider-agent' },
    rules: { minOrderTotal: deps.rules.minOrderTotal, markupPct: deps.rules.markupPct },
  }));

  /* Каталог магазина глазами агента — публичен, как и у самого магазина */
  app.get('/catalog', async () => deps.store.catalog());

  const requirePlatformJwt = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    try {
      if (!token) throw new Error('missing token');
      verifyJwt(token, deps.jwtSecret, { iss: 'platform', aud: 'provider-agent', clock: deps.clock });
    } catch {
      await reply.code(401).send({ error: 'unauthorized' });
    }
  };

  const parseBody = <T>(schema: z.ZodType<T>, req: FastifyRequest, reply: FastifyReply): T | undefined => {
    const parsed = schema.safeParse(typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body);
    if (!parsed.success) {
      void reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });
      return undefined;
    }
    return parsed.data;
  };

  app.post('/quote', { preHandler: requirePlatformJwt }, async (req, reply) => {
    const body = parseBody(QuoteBody, req, reply);
    if (!body) return reply;
    return makeQuote(fulfilDeps, { ...body, correlationId: req.id });
  });

  app.post('/fulfil', { preHandler: requirePlatformJwt }, async (req, reply) => {
    const body = parseBody(FulfilBody, req, reply);
    if (!body) return reply;
    /* 202: результат придёт через K5 (B1) */
    setImmediate(() => {
      void startFulfil(fulfilDeps, { ...body, correlationId: req.id }).catch((err) =>
        app.log.error({ dealId: body.dealId, err: String(err) }, 'fulfil crashed'));
    });
    return reply.code(202).send({ accepted: true });
  });

  app.post('/cancel', { preHandler: requirePlatformJwt }, async (req, reply) => {
    const body = parseBody(CancelBody, req, reply);
    if (!body) return reply;
    setImmediate(() => {
      void cancelDeal(fulfilDeps, body.dealId, body.reason).catch((err) =>
        app.log.error({ dealId: body.dealId, err: String(err) }, 'cancel crashed'));
    });
    return reply.code(202).send({ accepted: true });
  });

  app.post('/hooks/store', async (req, reply) => {
    const outcome = await handleStoreWebhook(
      fulfilDeps,
      typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}),
      req.headers['x-store-signature'] as string | undefined,
      req.id,
    );
    return reply.code(outcome.code).send(outcome.body);
  });

  return { app, book };
}
