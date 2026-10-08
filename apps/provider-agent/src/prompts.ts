import { z } from 'zod';
import type { Catalog, Req } from '@fdtd/contracts';
import type { LlmRequest, LlmToolDef } from '@fdtd/shared';

/**
 * Единственная LLM-задача исполнителя: подобрать sku под каждый itemQuery
 * по снимку каталога (концепт 3.4). Цена и остаток БЕРУТСЯ НЕ У LLM —
 * агент ходит в живой магазин (B15). Tool-definition из Zod (U4).
 */
export const ProductSelection = z.object({
  selections: z.array(z.object({
    itemIndex: z.number().int().nonnegative(),
    /** null — подходящего товара в каталоге нет (весь заказ или ничего, B4). */
    sku: z.string().nullable(),
    reason: z.string().optional(),
  })).min(1),
});
export type ProductSelection = z.infer<typeof ProductSelection>;

export const SELECT_TOOL: LlmToolDef = {
  name: 'select_products',
  description: 'Сопоставить каждую позицию запроса с товаром каталога или честно сказать, что товара нет',
  input_schema: z.toJSONSchema(ProductSelection) as Record<string, unknown>,
};

export function pickPrompt(req: Req, catalog: Catalog): LlmRequest {
  const items = req.items
    .map((it, i) => `${i}. "${it.itemQuery}" — ${it.quantity} ${it.unit}, категория ${it.category}`)
    .join('\n');
  const rows = catalog
    .map((p) => `- ${p.sku} | ${p.title}${p.description ? ` | ${p.description}` : ''} | ${p.unit} | категория ${p.category ?? '—'}`)
    .join('\n');
  return {
    system:
      'Ты подбираешь товары магазина под запрос покупателя. Для каждой позиции запроса выбери ровно один sku из каталога '
      + 'или sku: null, если подходящего товара нет. Не выдумывай sku. Ответь только вызовом select_products.',
    messages: [{ role: 'user', content: `Запрос:\n${items}\n\nКаталог:\n${rows}` }],
    tools: [SELECT_TOOL],
  };
}
