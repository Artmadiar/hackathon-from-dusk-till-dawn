import type { Llm, LlmRequest, LlmResult } from '@fdtd/shared';

/**
 * LLM=fake (B10): детерминированный подбор sku «по подстроке» (plan 1.3).
 * Понимает только формат pickPrompt: строки запроса `N. "query" — qty unit, категория cat`
 * и каталога `- SKU | title [| описание] | unit | категория cat`.
 */

const tokens = (s: string): Set<string> =>
  new Set(s.toLowerCase().split(/[^a-zа-яё0-9]+/i).filter((t) => t.length >= 2));

export function fakeProviderLlm(): Llm {
  return {
    async complete(req: LlmRequest): Promise<LlmResult> {
      const text = req.messages.map((m) => m.content).join('\n');
      const items = [...text.matchAll(/^(\d+)\. "(.+?)" — \d+ \S+, категория (\S+)$/gm)]
        .map((m) => ({ index: Number(m[1]), query: m[2]!, category: m[3]! }));
      const catalog = [...text.matchAll(/^- (.+)$/gm)].map((m) => {
        const parts = m[1]!.split(' | ');
        const category = parts.at(-1)!.replace('категория ', '');
        return { sku: parts[0]!, text: parts.slice(1, -1).join(' '), category };
      });

      const selections = items.map((item) => {
        const q = tokens(item.query);
        let best: { sku: string; score: number } | undefined;
        for (const p of catalog) {
          if (p.category !== item.category) continue;
          const overlap = [...tokens(p.text)].filter((t) => q.has(t)).length;
          if (!best || overlap > best.score) best = { sku: p.sku, score: overlap };
        }
        return { itemIndex: item.index, sku: best?.sku ?? null, reason: best ? undefined : 'no_category_match' };
      });

      return { text: '', toolUses: [{ name: 'select_products', input: { selections } }] };
    },
  };
}
