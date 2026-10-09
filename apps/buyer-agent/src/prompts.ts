import { z } from 'zod';
import { Category, type Quote, type Req } from '@fdtd/contracts';
import type { LlmRequest, LlmToolDef } from '@fdtd/shared';

/** Tool-definitions из Zod (U4). Деньги от LLM — десятичные доллары, центы на границе (R5). */

export const ParsedTask = z.object({
  items: z.array(z.object({
    itemQuery: z.string().min(1),
    quantity: z.number().int().positive(),
    unit: z.string().min(1),
    category: Category,
  })).min(1),
  deadline: z.string().min(1),
  /** null — пользователь бюджет не назвал. */
  budgetUsd: z.number().positive().nullable(),
  assumptions: z.array(z.string()).default([]),
});
export type ParsedTask = z.infer<typeof ParsedTask>;

export const PARSE_TOOL: LlmToolDef = {
  name: 'parse_task',
  description: 'Разобрать свободный текст пользователя в структурированный запрос закупки',
  input_schema: z.toJSONSchema(ParsedTask) as Record<string, unknown>,
};

export function parsePrompt(text: string, now: Date): LlmRequest {
  return {
    system:
      'Разбери запрос на закупку в структуру. Категории только из enum (paper|writing|water|office). '
      + `Дедлайн — абсолютная дата ISO; относительные сроки считай от ${now.toISOString()}. `
      + 'Чего в тексте нет — предположи разумно и перечисли каждое предположение в assumptions, по-английски (UI англоязычный). '
      + 'Бюджет бери только если пользователь назвал его сам, иначе budgetUsd: null. Ответь только вызовом parse_task.',
    messages: [{ role: 'user', content: text }],
    tools: [PARSE_TOOL],
  };
}

export const BudgetEstimate = z.object({
  lowUsd: z.number().positive(),
  highUsd: z.number().positive(),
  reasoning: z.string().optional(),
});
export type BudgetEstimate = z.infer<typeof BudgetEstimate>;

export const ESTIMATE_TOOL: LlmToolDef = {
  name: 'estimate_budget',
  description: 'Оценить ожидаемую рыночную стоимость всей закупки в долларах США',
  input_schema: z.toJSONSchema(BudgetEstimate) as Record<string, unknown>,
};

export function estimatePrompt(req: Req): LlmRequest {
  const items = req.items.map((i) => `- ${i.itemQuery}: ${i.quantity} ${i.unit}`).join('\n');
  return {
    system: 'Оцени рыночную стоимость закупки (вилка low–high, доллары США). Ответь только вызовом estimate_budget.',
    messages: [{ role: 'user', content: `Позиции:\n${items}` }],
    tools: [ESTIMATE_TOOL],
  };
}

export const QuoteMatches = z.object({
  matches: z.array(z.object({
    providerId: z.string().min(1),
    /** Соответствие товара запросу, 0–1 (концепт 3.6: только это даёт LLM). */
    match: z.number().min(0).max(1),
    comment: z.string().optional(),
  })),
});
export type QuoteMatches = z.infer<typeof QuoteMatches>;

export const MATCH_TOOL: LlmToolDef = {
  name: 'score_quotes',
  description: 'Оценить, насколько товары в каждой оферте соответствуют запрошенным позициям (0–1)',
  input_schema: z.toJSONSchema(QuoteMatches) as Record<string, unknown>,
};

export function matchPrompt(req: Req, quotes: Array<{ providerId: string; quote: Quote }>, preferencesNote?: string): LlmRequest {
  const items = req.items.map((i, n) => `${n}. "${i.itemQuery}" ${i.quantity} ${i.unit}`).join('\n');
  const offers = quotes
    .map(({ providerId, quote }) =>
      `${providerId}: ${quote.lines.map((l) => `"${l.title}" x${l.quantity}`).join(', ')}`)
    .join('\n');
  return {
    system:
      'Оцени для каждой оферты, тот ли это товар, что просил пользователь (match 0–1). '
      + 'Это сверка товара, не цены. Ответь только вызовом score_quotes.'
      + (preferencesNote ? `\nЗаметки о предпочтениях пользователя: ${preferencesNote}` : ''),
    messages: [{ role: 'user', content: `Запрос:\n${items}\n\nОферты:\n${offers}` }],
    tools: [MATCH_TOOL],
  };
}
