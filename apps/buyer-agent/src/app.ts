import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createApp, verifyJwt, type Clock, type IdGen, type Llm } from '@fdtd/shared';
import { parseTask } from './parse.js';
import type { BuyerPlatformPort } from './ports.js';
import { BuyerRunner } from './run.js';

export interface BuyerAgentDeps {
  llm: Llm;
  platform: BuyerPlatformPort;
  clock: Clock;
  idGen: IdGen;
  jwtSecret: string;
}

const RunBody = z.object({ taskId: z.string().min(1), reason: z.string().optional() });
const ParseBody = z.object({ text: z.string().min(1), deliveryAddress: z.string().min(1) });

export function createBuyerAgent(deps: BuyerAgentDeps): { app: FastifyInstance; runner: BuyerRunner } {
  const app = createApp({ service: 'buyer-agent' });
  const runner = new BuyerRunner({ ...deps, log: app.log });

  const requirePlatformJwt = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    try {
      if (!token) throw new Error('missing token');
      verifyJwt(token, deps.jwtSecret, { iss: 'platform', aud: 'buyer-agent', clock: deps.clock });
    } catch {
      await reply.code(401).send({ error: 'unauthorized' });
    }
  };

  /* B1: 202 сразу, работа в фоне, результат через K3 */
  app.post('/run', { preHandler: requirePlatformJwt }, async (req, reply) => {
    const parsed = RunBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });
    setImmediate(() => {
      void runner.run({ ...parsed.data, correlationId: req.id }).catch((err) =>
        app.log.error({ taskId: parsed.data.taskId, err: String(err) }, 'run dispatch failed'));
    });
    return reply.code(202).send({ accepted: true });
  });

  /* N1: кнопка «заполнить из текста» в UI (S9) */
  app.post('/parse', { preHandler: requirePlatformJwt }, async (req, reply) => {
    const parsed = ParseBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });
    const result = await parseTask(deps, { ...parsed.data, correlationId: req.id });
    if ('error' in result) return reply.code(422).send(result);
    return result;
  });

  return { app, runner };
}
