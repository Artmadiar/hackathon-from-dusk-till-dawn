import { Quote, type Req } from '@fdtd/contracts';
import type { Clock, IdGen, Llm } from '@fdtd/shared';
import type { AgentRules } from './config.js';
import { deliveryEta } from './eta.js';
import { pickPrompt, ProductSelection } from './prompts.js';
import type { PlatformPort, StoreClient } from './ports.js';

export type QuoteResult = { quote: Quote } | { refusal: string };

export interface QuoteDeps {
  providerId: string;
  rules: AgentRules;
  llm: Llm;
  store: StoreClient;
  platform: PlatformPort;
  clock: Clock;
  idGen: IdGen;
}

/**
 * make_quote (концепт 3.4, C32/C33): LLM подбирает sku по снимку каталога,
 * живой магазин даёт цену и остаток, правила магазина — поверх.
 * Любая несошедшаяся позиция -> отказ целиком (B4), без оферты.
 */
export async function makeQuote(
  deps: QuoteDeps,
  input: { taskId: string; request: Req; correlationId?: string },
): Promise<QuoteResult> {
  const { rules, clock } = deps;
  const runId = deps.idGen.next('run');
  const base = {
    kind: 'agent' as const,
    actor: `provider-agent:${deps.providerId}`,
    runId,
    taskId: input.taskId,
    providerId: deps.providerId,
    correlationId: input.correlationId,
  };
  const refuse = async (refusal: string): Promise<QuoteResult> => {
    await deps.platform.event({ ...base, type: 'DECISION', payload: { step: 'make_quote', refusal } });
    return { refusal };
  };

  await deps.platform.event({ ...base, type: 'STEP_STARTED', payload: { step: 'make_quote' } });
  const catalog = await deps.store.catalog();

  await deps.platform.event({ ...base, type: 'TOOL_CALL', payload: { tool: 'select_products', items: input.request.items.map((i) => i.itemQuery) } });
  const llmRes = await deps.llm.complete(pickPrompt(input.request, catalog));
  const toolUse = llmRes.toolUses.find((t) => t.name === 'select_products');
  if (!toolUse) return refuse('llm_no_selection');
  const parsed = ProductSelection.safeParse(toolUse.input);
  if (!parsed.success) return refuse('llm_bad_selection');
  await deps.platform.event({ ...base, type: 'TOOL_RESULT', payload: { tool: 'select_products', selections: parsed.data.selections } });

  const bySku = new Map(catalog.map((p) => [p.sku, p]));
  const lines: Quote['lines'] = [];
  for (const [itemIndex, item] of input.request.items.entries()) {
    const sel = parsed.data.selections.find((s) => s.itemIndex === itemIndex);
    if (!sel || sel.sku === null) return refuse(`no_match:${item.itemQuery}`);
    if (!bySku.has(sel.sku)) return refuse(`no_match:${item.itemQuery}`); // LLM выдумал sku
    /* живая цена и остаток (B15, C33) */
    const live = await deps.store.product(sel.sku);
    if (!live) return refuse(`no_match:${item.itemQuery}`);
    if (live.stock < item.quantity) return refuse(`out_of_stock:${sel.sku}`);
    const unitPrice = Math.ceil(live.price * (1 + rules.markupPct / 100));
    lines.push({
      itemIndex, sku: live.sku, title: live.title,
      unitPrice, quantity: item.quantity, lineTotal: unitPrice * item.quantity,
    });
  }

  const total = lines.reduce((s, l) => s + l.lineTotal, 0);
  if (total < rules.minOrderTotal) return refuse(`below_min_order:${rules.minOrderTotal}`);

  const now = clock.now();
  const quote = Quote.parse({
    lines,
    total,
    deliveryEta: deliveryEta(rules.schedule, rules.etaBufferDays, now),
    validUntil: new Date(now.getTime() + rules.quoteValidForMin * 60_000).toISOString(),
  });
  await deps.platform.event({ ...base, type: 'DECISION', payload: { step: 'make_quote', total, deliveryEta: quote.deliveryEta } });
  return { quote };
}
