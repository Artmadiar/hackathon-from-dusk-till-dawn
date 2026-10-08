import { expect } from 'vitest';

export const PLATFORM = process.env.E2E_PLATFORM_URL ?? 'http://localhost:3380';
export const STORES = {
  aqua: 'http://localhost:3390',
  papirna: 'http://localhost:3391',
  kancelar: 'http://localhost:3392',
  levny: 'http://localhost:3393',
};

export async function api(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${PLATFORM}${path}`, {
    method,
    headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

export const adminHeaders = { 'x-role': 'admin' };

export async function adminEvents(taskId?: string): Promise<Array<Record<string, unknown>>> {
  const q = taskId ? `?taskId=${encodeURIComponent(taskId)}&limit=500` : '?limit=500';
  const res = await api('GET', `/events${q}`, undefined, adminHeaders);
  expect(res.status).toBe(200);
  return (res.body as { events: Array<Record<string, unknown>> }).events;
}

export async function pollTask(
  taskId: string,
  until: (task: { status: string }) => boolean,
  timeoutMs = 60_000,
): Promise<{ task: Record<string, unknown> & { status: string }; deals: Array<Record<string, unknown>> }> {
  const start = Date.now();
  for (;;) {
    const res = await api('GET', `/tasks/${taskId}`);
    const data = res.body as { task: Record<string, unknown> & { status: string }; deals: Array<Record<string, unknown>> };
    if (res.status === 200 && until(data.task)) return data;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`task ${taskId} did not reach expected state in ${timeoutMs}ms; now: ${JSON.stringify(data.task)}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** Сброс demo-данных и пополнение кошелька покупателя на 100 $ (SIMULATED). */
export async function resetDemo(): Promise<void> {
  const seed = await api('POST', '/dev/seed');
  expect(seed.status).toBe(200);
  const dep = await api('POST', '/dev/deposit', {
    userId: 'buyer-1', amount: 10_000, idempotencyKey: `e2e-${Date.now()}`,
  });
  expect(dep.status).toBe(200);
}
