/**
 * S10: смоук основного сценария на LLM=real — прогон перед записью видео.
 * Отличие от e2e main-scenario: задача рождается из СВОБОДНОГО ТЕКСТА
 * (настоящий parse_task), дальше тот же C11+C19+C35.
 * Запуск: pnpm demo:real (поднимет стек с LLM=real и вызовет этот скрипт).
 */

const PLATFORM = process.env.E2E_PLATFORM_URL ?? 'http://localhost:3380';
const TEXT = 'Order 5 packs of A4 paper (500 sheets each), deliver within 4 days';

async function api(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${PLATFORM}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

function fail(msg: string): never {
  console.error(`\n✗ DEMO FAILED: ${msg}`);
  process.exit(1);
}

const t0 = Date.now();
const since = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

// 1. Сброс demo-данных и пополнение
let r = await api('POST', '/dev/seed');
if (r.status !== 200) fail(`seed: http ${r.status}`);
r = await api('POST', '/dev/deposit', { userId: 'buyer-1', amount: 10_000, idempotencyKey: `demo-${Date.now()}` });
if (r.status !== 200) fail(`deposit: http ${r.status}`);
console.log(`[${since()}] seeded, buyer-1 balance $100 (SIMULATED deposit)`);

// 2. Текст -> Req настоящим LLM
r = await api('POST', '/tasks/parse', { userId: 'buyer-1', text: TEXT });
if (r.status !== 200) fail(`parse: http ${r.status} ${JSON.stringify(r.body)}`);
const { request, assumptions } = r.body;
console.log(`[${since()}] parsed: ${request.items.length} item(s), deadline ${request.deadline}`);
for (const a of assumptions ?? []) console.log(`           ASSUMPTION: ${a}`);

// 3. Задача в работу
r = await api('POST', '/tasks', { userId: 'buyer-1', request });
if (r.status !== 201) fail(`create task: http ${r.status}`);
const taskId: string = r.body.task.id;
console.log(`[${since()}] task ${taskId} created`);

// 4. Ждём DONE
let task: any;
let deals: any[] = [];
const deadline = Date.now() + 180_000;
for (;;) {
  r = await api('GET', `/tasks/${taskId}`);
  task = r.body?.task;
  deals = r.body?.deals ?? [];
  if (task?.status === 'DONE' || task?.status === 'FAILED') break;
  if (Date.now() > deadline) fail(`timeout; task status ${task?.status}`);
  await new Promise((res) => setTimeout(res, 1000));
}
console.log(`[${since()}] task ${task.status}`);
for (const d of deals) {
  console.log(`           deal ${d.providerId}: ${d.status} $${(d.quote.total / 100).toFixed(2)}${d.cancelReason ? ` (${d.cancelReason})` : ''}`);
}
if (task.status !== 'DONE') fail(`expected DONE, got ${task.status}: ${task.failReason}`);

// 5. Инварианты основного сценария
const settled = deals.find((d) => d.status === 'SETTLED');
if (!settled || settled.providerId !== 'kancelar') fail('expected kancelar to settle');
const withdrawn = deals.find((d) => d.providerId === 'papirna' && d.status === 'CANCELLED');
if (!withdrawn) fail('expected papirna deal cancelled (out_of_stock)');

const wallet = await api('GET', '/wallets/user/buyer-1');
const kancelar = await api('GET', '/wallets/provider/kancelar');
console.log(`[${since()}] buyer balance $${(wallet.body.balance / 100).toFixed(2)} (held $${(wallet.body.held / 100).toFixed(2)}), kancelar earned $${(kancelar.body.balance / 100).toFixed(2)}`);
if (wallet.body.held !== 0) fail('buyer still has held funds');
if (wallet.body.balance + kancelar.body.balance !== 10_000) fail('money leaked: balances do not add up to $100');

console.log(`\n✓ DEMO OK in ${since()}: text -> parse (real LLM) -> quotes -> papirna out_of_stock -> kancelar SETTLED $${(settled.quote.total / 100).toFixed(2)}`);
