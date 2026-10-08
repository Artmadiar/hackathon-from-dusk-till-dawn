import type { Llm, LlmRequest, LlmResult } from '@fdtd/shared';

/**
 * LLM=fake (B10): оценка бюджета «по словарю» и плоский match (plan 1.3).
 * Понимает форматы estimatePrompt (`- query: qty unit`) и matchPrompt
 * (`providerId: "title" xN, ...`). parse_task фейк не умеет — вернёт пусто,
 * /parse ответит 422 (кнопка «из текста» требует LLM=real).
 */

/** Словарь ожидаемых цен за единицу, центы. */
const PRICE_DICT: Array<{ re: RegExp; cents: number }> = [
  { re: /бумаг|пап[иі]р|papír|paper|a4/i, cents: 800 },
  { re: /руч|перо|pero|pen|каранда|tužk/i, cents: 150 },
  { re: /вода|вод[ыу]|voda|water|барел/i, cents: 1300 },
  { re: /конверт|obálk|envelope/i, cents: 300 },
];
const DEFAULT_CENTS = 400;

export function fakeBuyerLlm(): Llm {
  return {
    async complete(req: LlmRequest): Promise<LlmResult> {
      const system = req.system ?? '';
      const text = req.messages.map((m) => m.content).join('\n');

      if (system.includes('estimate_budget')) {
        let total = 0;
        for (const m of text.matchAll(/^- (.+?): (\d+) \S+$/gm)) {
          const unit = PRICE_DICT.find((d) => d.re.test(m[1]!))?.cents ?? DEFAULT_CENTS;
          total += unit * Number(m[2]);
        }
        if (total === 0) total = DEFAULT_CENTS;
        return {
          text: '',
          toolUses: [{
            name: 'estimate_budget',
            input: {
              lowUsd: Math.floor(total * 0.9) / 100,
              highUsd: Math.ceil(total * 1.2) / 100,
              reasoning: 'словарь demo-цен (LLM=fake)',
            },
          }],
        };
      }

      if (system.includes('score_quotes')) {
        const matches = [...text.matchAll(/^([a-z0-9-]+): /gm)]
          .map((m) => ({ providerId: m[1]!, match: 0.85 }));
        return { text: '', toolUses: [{ name: 'score_quotes', input: { matches } }] };
      }

      return { text: '', toolUses: [] };
    },
  };
}
