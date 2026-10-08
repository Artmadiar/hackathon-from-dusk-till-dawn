import { Req } from '@fdtd/contracts';
import type { Clock, Llm } from '@fdtd/shared';
import { ParsedTask, parsePrompt } from './prompts.js';
import type { BuyerPlatformPort } from './ports.js';

export interface ParseDeps {
  llm: Llm;
  clock: Clock;
  platform: BuyerPlatformPort;
}

export type ParseResult =
  | { request: Req; assumptions: string[] }
  | { error: string };

/**
 * N1: свободный текст -> Req. Категории из enum и абсолютный дедлайн
 * гарантирует схема; бюджет пользователя — жёсткий (source: user),
 * нет бюджета — заглушка max 0 до estimate_budget (C35).
 */
export async function parseTask(
  deps: ParseDeps,
  input: { text: string; deliveryAddress: string; taskId?: string; runId?: string; correlationId?: string },
): Promise<ParseResult> {
  const res = await deps.llm.complete(parsePrompt(input.text, deps.clock.now()));
  const toolUse = res.toolUses.find((t) => t.name === 'parse_task');
  if (!toolUse) return { error: 'llm_no_parse' };
  const parsed = ParsedTask.safeParse(toolUse.input);
  if (!parsed.success) return { error: 'llm_bad_parse' };
  const p = parsed.data;

  const request = Req.parse({
    items: p.items,
    categories: [...new Set(p.items.map((i) => i.category))],
    budget: p.budgetUsd === null
      ? { max: 0, source: 'estimated' }               // оценим перед офертами
      : { max: Math.round(p.budgetUsd * 100), source: 'user' }, // R5: центы на границе
    deadline: new Date(p.deadline).toISOString(),
    deliveryAddress: input.deliveryAddress,
  });

  for (const assumption of p.assumptions) {
    await deps.platform.event({
      kind: 'agent', actor: 'buyer-agent', type: 'ASSUMPTION',
      taskId: input.taskId, runId: input.runId, correlationId: input.correlationId,
      payload: { step: 'parse_task', assumption },
    });
  }
  return { request, assumptions: p.assumptions };
}
