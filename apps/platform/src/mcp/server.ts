import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { deals, tasks, wallets, type User } from '../db/schema.js';
import type { AuthService } from '../auth/service.js';
import type { DealService } from '../deals/deal-service.js';
import type { AgentDispatcher } from '../dispatcher/dispatcher.js';

export interface McpDeps {
  db: Db;
  auth: AuthService;
  deals: DealService;
  dispatcher: AgentDispatcher;
  fallbackDeliveryAddress?: string;
}

/**
 * 3.7: MCP-сервер площадки в процессе платформы. Авторизация — API-ключ
 * пользователя (B8; OAuth 2.1 — в limitations). Stateless: транспорт на запрос.
 */
export function registerMcpRoutes(app: FastifyInstance, deps: McpDeps): void {
  app.post('/mcp', async (req, reply) => {
    const user = await userFromRequest(req, deps.auth);
    if (!user) {
      return reply.code(401).send({
        jsonrpc: '2.0', id: null,
        error: { code: -32001, message: 'unauthorized: pass user API key as Bearer token or x-api-key' },
      });
    }
    const server = buildServer(deps, user);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    reply.hijack();
    req.raw.on('close', () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });

  // stateless: SSE-стрима и сессий нет
  app.get('/mcp', async (_req, reply) => reply.code(405).send({ error: 'method_not_allowed' }));
  app.delete('/mcp', async (_req, reply) => reply.code(405).send({ error: 'method_not_allowed' }));
}

async function userFromRequest(req: FastifyRequest, auth: AuthService): Promise<User | undefined> {
  const header = req.headers.authorization;
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  const xKey = req.headers['x-api-key'];
  const key = bearer ?? (typeof xKey === 'string' ? xKey : undefined);
  return key ? auth.userByApiKey(key) : undefined;
}

const TOOLS = [
  {
    name: 'create_task',
    description: 'Создать задачу закупки из свободного текста («закажи 5 пачек бумаги A4 до пятницы»). '
      + 'Текст разбирает агент-заказчик, задача сразу уходит в работу.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Что купить, словами' } },
      required: ['text'],
    },
  },
  {
    name: 'get_task',
    description: 'Статус задачи и её сделок по id.',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' } },
      required: ['taskId'],
    },
  },
  {
    name: 'wallet_balance',
    description: 'Баланс кошелька: balance, held, available (в центах USD).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_deals',
    description: 'Сделки по задачам пользователя (опционально по одной задаче).',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' } },
    },
  },
] as const;

function buildServer(deps: McpDeps, user: User): Server {
  const server = new Server(
    { name: 'fdtd-platform', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...TOOLS] }));

  server.setRequestHandler(CallToolRequestSchema, async (call) => {
    try {
      const result = await callTool(deps, user, call.params.name, call.params.arguments ?? {});
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return {
        isError: true,
        content: [{ type: 'text', text: `error: ${(e as Error).message}` }],
      };
    }
  });

  return server;
}

async function callTool(deps: McpDeps, user: User, name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'create_task': {
      const { text } = z.object({ text: z.string().min(1) }).parse(args);
      const deliveryAddress = user.deliveryAddress ?? deps.fallbackDeliveryAddress ?? 'не указан';
      const parsed = await deps.dispatcher.parseTask({ text, deliveryAddress });
      if ('error' in parsed) return { error: 'parse_failed', detail: parsed };
      const task = await deps.deals.createTask({ userId: user.id, request: parsed.request, createdVia: 'mcp' });
      deps.dispatcher.runBuyer({ taskId: task.id, reason: 'task_created' }).catch(() => { /* агент сам залогирует */ });
      return { taskId: task.id, status: task.status, request: parsed.request, assumptions: parsed.assumptions };
    }
    case 'get_task': {
      const { taskId } = z.object({ taskId: z.string().min(1) }).parse(args);
      const task = await deps.deals.getTask(taskId);
      if (!task || (user.role !== 'admin' && task.userId !== user.id)) throw new Error(`task ${taskId} not found`);
      const taskDeals = await deps.db.select().from(deals).where(eq(deals.taskId, task.id));
      return { task, deals: taskDeals };
    }
    case 'wallet_balance': {
      const [w] = await deps.db.select().from(wallets)
        .where(eq(wallets.ownerId, user.role === 'provider' ? (user.providerId ?? user.id) : user.id));
      if (!w) return { balance: 0, held: 0, available: 0, note: 'wallet not created yet' };
      return { balance: w.balance, held: w.held, available: w.balance - w.held, currency: w.currency };
    }
    case 'list_deals': {
      const { taskId } = z.object({ taskId: z.string().optional() }).parse(args);
      if (taskId) {
        const task = await deps.deals.getTask(taskId);
        if (!task || (user.role !== 'admin' && task.userId !== user.id)) throw new Error(`task ${taskId} not found`);
        return { deals: await deps.db.select().from(deals).where(eq(deals.taskId, taskId)) };
      }
      const own = await deps.db.select({ id: tasks.id }).from(tasks).where(eq(tasks.userId, user.id));
      if (!own.length) return { deals: [] };
      return { deals: await deps.db.select().from(deals).where(inArray(deals.taskId, own.map((t) => t.id))) };
    }
    default:
      throw new Error(`unknown tool ${name}`);
  }
}
