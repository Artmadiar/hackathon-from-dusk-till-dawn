import type { Llm, LlmRequest, LlmResult } from '@fdtd/shared';

/**
 * LLM=fake (B10): оценка бюджета «по словарю», плоский match и эвристический
 * parse_task (сегменты через запятую/«и»: количество + категория по словарю,
 * бюджет «NN долларов», дедлайн по дню недели). Разбор честно помечается
 * ASSUMPTION'ом «LLM=fake»; настоящий разбор — LLM=real (S10).
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
              reasoning: 'demo price table (LLM=fake)',
            },
          }],
        };
      }

      if (system.includes('parse_task')) {
        const input = fakeParse(text, req);
        return input ? { text: '', toolUses: [{ name: 'parse_task', input }] } : { text: '', toolUses: [] };
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

const WEEKDAYS: Array<{ re: RegExp; dow: number }> = [
  { re: /понедельник/i, dow: 1 }, { re: /вторник/i, dow: 2 }, { re: /сред[ыу]/i, dow: 3 },
  { re: /четверг/i, dow: 4 }, { re: /пятниц/i, dow: 5 }, { re: /суббот/i, dow: 6 }, { re: /воскресень/i, dow: 0 },
];

function category(s: string): string | undefined {
  if (/бумаг|пап[иі]р|papír|paper|a4|конверт|obálk/i.test(s)) return 'paper';
  if (/руч|каранда|перо|pero|pen|tužk/i.test(s)) return 'writing';
  if (/вода|вод[ыу]|voda|water|барел|бутыл/i.test(s)) return 'water';
  if (/степлер|скрепк|папк|офис|office/i.test(s)) return 'office';
  return undefined;
}

/** Эвристический parse_task для LLM=fake: деминимум, чтобы демо жило без ключа. */
function fakeParse(text: string, req: LlmRequest): Record<string, unknown> | undefined {
  const nowMatch = (req.system ?? '').match(/от (\d{4}-\d{2}-\d{2}T[\d:.]+Z)/);
  const now = nowMatch ? new Date(nowMatch[1]!) : new Date();
  const assumptions: string[] = ['LLM=fake: parsed heuristically, not by a model'];

  const budgetMatch = text.match(/бюджет\D{0,10}(\d+)/i) ?? text.match(/(\d+)\s*(?:доллар|\$|usd)/i);
  const budgetUsd = budgetMatch ? Number(budgetMatch[1]) : null;

  let deadline: Date | undefined;
  for (const w of WEEKDAYS) {
    if (w.re.test(text)) {
      const d = new Date(now);
      do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() !== w.dow);
      d.setUTCHours(17, 0, 0, 0);
      deadline = d;
      assumptions.push(`deadline: nearest requested weekday, 17:00 UTC (${d.toISOString()})`);
      break;
    }
  }
  if (!deadline && /завтра/i.test(text)) {
    deadline = new Date(now.getTime() + 86400_000);
    assumptions.push('deadline: tomorrow, same time of day');
  }
  if (!deadline) {
    deadline = new Date(now.getTime() + 3 * 86400_000);
    assumptions.push('no deadline given — assumed +3 days');
  }

  const cleaned = text
    .replace(/бюджет\D{0,10}\d+\s*(?:доллар\w*|\$|usd)?/gi, '')
    .replace(/до\s+(?:понедельника|вторника|среды|четверга|пятницы|субботы|воскресенья|завтра)/gi, '');
  const items: Array<Record<string, unknown>> = [];
  for (const seg of cleaned.split(/,|;| и /i)) {
    const cat = category(seg);
    if (!cat) continue;
    const qty = seg.match(/(\d+)/);
    const unit = /пач|pack/i.test(seg) ? 'pack' : /короб|box/i.test(seg) ? 'box' : /барел|бутыл|bottle/i.test(seg) ? 'bottle' : 'pcs';
    items.push({
      // \W без флага u режет кириллицу — чистим края только от пробелов и пунктуации
      itemQuery: seg.replace(/^[\s.,;:!?«»"']+|[\s.,;:!?«»"']+$/g, '').replace(/^закажи\s+|^купи\s+/i, '') || seg.trim(),
      quantity: qty ? Number(qty[1]) : 1,
      unit,
      category: cat,
    });
  }
  if (!items.length) return undefined;
  if (items.some((i) => i.quantity === 1)) assumptions.push('quantity not given — assumed 1');
  return { items, deadline: deadline.toISOString(), budgetUsd, assumptions };
}
