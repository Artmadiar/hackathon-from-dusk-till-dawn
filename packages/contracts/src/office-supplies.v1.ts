import { z } from 'zod';
import { Category } from './categories.js';
import { Cents, PositiveInt } from './money.js';
import type { ContractType, Violation } from './contract-type.js';

const IsoDateTime = z.iso.datetime({ offset: true });

export const ReqItem = z.object({
  itemQuery: z.string().min(1),
  quantity: PositiveInt,
  unit: z.string().min(1),
  category: Category,
});

export const Req = z.object({
  items: z.array(ReqItem).min(1),
  categories: z.array(Category).min(1),
  budget: z.object({ max: Cents, source: z.enum(['user', 'estimated']) }),
  deadline: IsoDateTime,
  deliveryAddress: z.string().min(1),
});
export type Req = z.infer<typeof Req>;

export const QuoteLine = z.object({
  itemIndex: z.number().int().nonnegative(),
  sku: z.string().min(1),
  title: z.string().min(1),
  unitPrice: Cents,
  quantity: PositiveInt,
  lineTotal: Cents,
});

export const Quote = z.object({
  lines: z.array(QuoteLine).min(1),
  total: Cents,
  deliveryEta: IsoDateTime,
  validUntil: IsoDateTime,
});
export type Quote = z.infer<typeof Quote>;

export const ProofLine = z.object({
  sku: z.string().min(1),
  confirmedQuantity: z.number().int().nonnegative(),
});

export const Proof = z.object({
  storeOrderId: z.string().min(1),
  invoiceNumber: z.string(), // пустой счёт ловит validateProof (C21), не схема
  lines: z.array(ProofLine).min(1),
  confirmedTotal: Cents,
  deliveryEta: IsoDateTime,
  trackingNumber: z.string().optional(),
});
export type Proof = z.infer<typeof Proof>;

/** Сравнение сроков — по дате (UTC), не по времени: R4. */
const dateOnly = (iso: string): string => new Date(iso).toISOString().slice(0, 10);

export function validateQuote(req: Req, quote: Quote, now: Date): Violation[] {
  const v: Violation[] = [];

  req.items.forEach((item, i) => {
    const lines = quote.lines.filter((l) => l.itemIndex === i);
    if (lines.length === 0) {
      v.push({ code: 'line_missing', severity: 'error', itemIndex: i,
        message: `no quote line for item #${i} "${item.itemQuery}"` });
      return;
    }
    if (lines.length > 1) {
      v.push({ code: 'line_duplicate', severity: 'error', itemIndex: i,
        message: `item #${i} has ${lines.length} quote lines, expected exactly one` });
      return;
    }
    const line = lines[0]!;
    if (line.quantity !== item.quantity) {
      v.push({ code: 'quantity_mismatch', severity: 'error', itemIndex: i,
        message: `item #${i}: requested ${item.quantity}, quoted ${line.quantity}` });
    }
    if (line.lineTotal !== line.unitPrice * line.quantity) {
      v.push({ code: 'line_total_mismatch', severity: 'error', itemIndex: i,
        message: `item #${i}: lineTotal ${line.lineTotal} != unitPrice ${line.unitPrice} x ${line.quantity}` });
    }
  });

  for (const line of quote.lines) {
    if (line.itemIndex >= req.items.length) {
      v.push({ code: 'line_unknown_item', severity: 'error', itemIndex: line.itemIndex,
        message: `quote line references unknown item #${line.itemIndex}` });
    }
  }

  const sum = quote.lines.reduce((s, l) => s + l.lineTotal, 0);
  if (quote.total !== sum) {
    v.push({ code: 'total_mismatch', severity: 'error',
      message: `total ${quote.total} != sum of lines ${sum}` });
  }

  if (quote.total > req.budget.max) {
    // Жёстко режет только бюджет пользователя; оценённый — мягкий (R2, C35)
    v.push({ code: 'over_budget',
      severity: req.budget.source === 'user' ? 'error' : 'warning',
      message: `total ${quote.total} > budget.max ${req.budget.max} (source: ${req.budget.source})` });
  }

  if (dateOnly(quote.deliveryEta) > dateOnly(req.deadline)) {
    v.push({ code: 'eta_after_deadline', severity: 'error',
      message: `deliveryEta ${quote.deliveryEta} is after deadline ${req.deadline} (by date)` });
  }

  if (new Date(quote.validUntil).getTime() <= now.getTime()) {
    v.push({ code: 'quote_expired', severity: 'error',
      message: `validUntil ${quote.validUntil} is not after now ${now.toISOString()}` });
  }

  return v;
}

export function validateProof(quote: Quote, proof: Proof): Violation[] {
  const v: Violation[] = [];

  if (proof.invoiceNumber.trim() === '') {
    v.push({ code: 'empty_invoice', severity: 'error', message: 'invoiceNumber is empty' });
  }

  for (const line of quote.lines) {
    const p = proof.lines.find((pl) => pl.sku === line.sku);
    if (!p) {
      v.push({ code: 'proof_line_missing', severity: 'error', sku: line.sku,
        message: `no proof line for sku ${line.sku}` });
      continue;
    }
    if (p.confirmedQuantity < line.quantity) {
      // Частичное исполнение не принимаем (B4)
      v.push({ code: 'short_quantity', severity: 'error', sku: line.sku,
        message: `sku ${line.sku}: confirmed ${p.confirmedQuantity} < quoted ${line.quantity}` });
    }
  }

  if (proof.confirmedTotal > quote.total) {
    v.push({ code: 'over_total', severity: 'error',
      message: `confirmedTotal ${proof.confirmedTotal} > quoted total ${quote.total}` });
  }

  if (dateOnly(proof.deliveryEta) > dateOnly(quote.deliveryEta)) {
    v.push({ code: 'eta_after_quote_eta', severity: 'error',
      message: `confirmed deliveryEta ${proof.deliveryEta} is after quoted ${quote.deliveryEta} (by date)` });
  }

  return v;
}

export const officeSuppliesV1: ContractType<Req, Quote, Proof> = {
  id: 'office-supplies.v1',
  requestSchema: Req,
  quoteSchema: Quote,
  proofSchema: Proof,
  validateQuote,
  validateProof,
};
