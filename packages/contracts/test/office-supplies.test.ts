import { describe, expect, it } from 'vitest';
import {
  CATEGORIES, Category, Proof, Quote, Req, StoreWebhook,
  validateProof, validateQuote,
} from '../src/index.js';
import type { Proof as ProofT, Quote as QuoteT, Req as ReqT } from '../src/index.js';

const NOW = new Date('2026-10-08T12:00:00Z');

const baseReq: ReqT = {
  items: [
    { itemQuery: 'бумага A4 80г', quantity: 10, unit: 'pack', category: 'paper' },
    { itemQuery: 'синие ручки', quantity: 20, unit: 'pcs', category: 'writing' },
  ],
  categories: ['paper', 'writing'],
  budget: { max: 6000, source: 'user' },
  deadline: '2026-10-10T00:00:00Z',
  deliveryAddress: 'Praha 7, Dukelských hrdinů 21',
};

const baseQuote: QuoteT = {
  lines: [
    { itemIndex: 0, sku: 'A4-80', title: 'Paper A4 80g 500 sheets', unitPrice: 300, quantity: 10, lineTotal: 3000 },
    { itemIndex: 1, sku: 'PEN-BL', title: 'Blue ballpoint pen', unitPrice: 100, quantity: 20, lineTotal: 2000 },
  ],
  total: 5000,
  deliveryEta: '2026-10-09T15:00:00Z',
  validUntil: '2026-10-08T18:00:00Z',
};

const baseProof: ProofT = {
  storeOrderId: 'so-1',
  invoiceNumber: 'INV-007',
  lines: [
    { sku: 'A4-80', confirmedQuantity: 10 },
    { sku: 'PEN-BL', confirmedQuantity: 20 },
  ],
  confirmedTotal: 5000,
  deliveryEta: '2026-10-09T15:00:00Z',
};

const codes = (vs: { code: string }[]) => vs.map((v) => v.code);

describe('validateQuote (2.1: C14, C15, C31, C32, R4)', () => {
  it('C11 valid quote has no violations', () => {
    expect(validateQuote(baseReq, baseQuote, NOW)).toEqual([]);
  });

  it('C31/C32 позиция без строки -> line_missing', () => {
    const quote: QuoteT = { ...baseQuote, lines: [baseQuote.lines[0]!], total: 3000 };
    const v = validateQuote(baseReq, quote, NOW);
    expect(codes(v)).toContain('line_missing');
    expect(v.find((x) => x.code === 'line_missing')!.itemIndex).toBe(1);
  });

  it('количество не совпало -> quantity_mismatch', () => {
    const lines = [
      { ...baseQuote.lines[0]!, quantity: 5, lineTotal: 1500 },
      baseQuote.lines[1]!,
    ];
    const v = validateQuote(baseReq, { ...baseQuote, lines, total: 3500 }, NOW);
    expect(codes(v)).toEqual(['quantity_mismatch']);
  });

  it('две строки на одну позицию -> line_duplicate', () => {
    const lines = [...baseQuote.lines, { ...baseQuote.lines[0]!, sku: 'A4-90' }];
    const v = validateQuote(baseReq, { ...baseQuote, lines, total: 8000 }, NOW);
    expect(codes(v)).toContain('line_duplicate');
  });

  it('строка на несуществующую позицию -> line_unknown_item', () => {
    const lines = [...baseQuote.lines, { ...baseQuote.lines[0]!, itemIndex: 7 }];
    const v = validateQuote(baseReq, { ...baseQuote, lines, total: 8000 }, NOW);
    expect(codes(v)).toContain('line_unknown_item');
  });

  it('C14 срок позже дедлайна по дате -> eta_after_deadline', () => {
    const v = validateQuote(baseReq, { ...baseQuote, deliveryEta: '2026-10-11T09:00:00Z' }, NOW);
    expect(codes(v)).toEqual(['eta_after_deadline']);
  });

  it('R4 тот же день, позже по времени -> OK (сравнение по дате)', () => {
    const req = { ...baseReq, deadline: '2026-10-10T09:00:00Z' };
    const v = validateQuote(req, { ...baseQuote, deliveryEta: '2026-10-10T18:00:00Z' }, NOW);
    expect(v).toEqual([]);
  });

  it('validUntil истёк -> quote_expired (граница: равно now — тоже истёк)', () => {
    expect(codes(validateQuote(baseReq, { ...baseQuote, validUntil: '2026-10-08T11:00:00Z' }, NOW)))
      .toEqual(['quote_expired']);
    expect(codes(validateQuote(baseReq, { ...baseQuote, validUntil: NOW.toISOString() }, NOW)))
      .toEqual(['quote_expired']);
  });

  it('C35 total > budget: error при source=user, warning при source=estimated', () => {
    const req = { ...baseReq, budget: { max: 4000, source: 'user' as const } };
    const vUser = validateQuote(req, baseQuote, NOW);
    expect(vUser).toHaveLength(1);
    expect(vUser[0]).toMatchObject({ code: 'over_budget', severity: 'error' });

    const reqEst = { ...baseReq, budget: { max: 4000, source: 'estimated' as const } };
    const vEst = validateQuote(reqEst, baseQuote, NOW);
    expect(vEst).toHaveLength(1);
    expect(vEst[0]).toMatchObject({ code: 'over_budget', severity: 'warning' });
  });

  it('арифметика: lineTotal и total должны сходиться', () => {
    const lines = [{ ...baseQuote.lines[0]! , lineTotal: 2999 }, baseQuote.lines[1]!];
    const v = validateQuote(baseReq, { ...baseQuote, lines, total: 5000 }, NOW);
    expect(codes(v)).toContain('line_total_mismatch');
    expect(codes(v)).toContain('total_mismatch');
  });
});

describe('validateProof (2.1: C21)', () => {
  it('валидный proof -> нет нарушений', () => {
    expect(validateProof(baseQuote, baseProof)).toEqual([]);
  });

  it('количество меньше заказанного -> short_quantity (B4: partial не принимаем)', () => {
    const proof = { ...baseProof, lines: [{ sku: 'A4-80', confirmedQuantity: 8 }, baseProof.lines[1]!] };
    expect(codes(validateProof(baseQuote, proof))).toEqual(['short_quantity']);
  });

  it('сумма больше оферты -> over_total', () => {
    expect(codes(validateProof(baseQuote, { ...baseProof, confirmedTotal: 5500 }))).toEqual(['over_total']);
  });

  it('срок позже оферты по дате -> eta_after_quote_eta; тот же день позже по времени -> OK (R4)', () => {
    expect(codes(validateProof(baseQuote, { ...baseProof, deliveryEta: '2026-10-11T08:00:00Z' })))
      .toEqual(['eta_after_quote_eta']);
    expect(validateProof(baseQuote, { ...baseProof, deliveryEta: '2026-10-09T23:00:00Z' })).toEqual([]);
  });

  it('пустой счёт -> empty_invoice', () => {
    expect(codes(validateProof(baseQuote, { ...baseProof, invoiceNumber: '  ' }))).toEqual(['empty_invoice']);
  });

  it('нет строки по sku из оферты -> proof_line_missing', () => {
    const proof = { ...baseProof, lines: [baseProof.lines[0]!] };
    expect(codes(validateProof(baseQuote, proof))).toEqual(['proof_line_missing']);
  });
});

describe('схемы: только целые центы (R5)', () => {
  it('Quote с десятичной ценой не проходит', () => {
    const q = { ...baseQuote, lines: [{ ...baseQuote.lines[0]!, unitPrice: 300.5 }] };
    expect(Quote.safeParse(q).success).toBe(false);
  });

  it('Req с десятичным бюджетом не проходит', () => {
    expect(Req.safeParse({ ...baseReq, budget: { max: 59.99, source: 'user' } }).success).toBe(false);
  });

  it('Proof с десятичной суммой не проходит', () => {
    expect(Proof.safeParse({ ...baseProof, confirmedTotal: 4999.5 }).success).toBe(false);
  });

  it('отрицательные деньги не проходят', () => {
    expect(Quote.safeParse({ ...baseQuote, total: -1 }).success).toBe(false);
  });
});

describe('схемы: enum категорий и форма Req', () => {
  it('enum категорий зафиксирован', () => {
    expect(CATEGORIES).toEqual(['paper', 'writing', 'water', 'office']);
    expect(Category.safeParse('snacks').success).toBe(false);
  });

  it('категория вне enum в items не проходит', () => {
    const req = { ...baseReq, items: [{ ...baseReq.items[0]!, category: 'snacks' }] };
    expect(Req.safeParse(req).success).toBe(false);
  });

  it('Req с пустым items не проходит', () => {
    expect(Req.safeParse({ ...baseReq, items: [] }).success).toBe(false);
  });
});

describe('схема webhook магазина (K7)', () => {
  it('confirmed без invoiceNumber не проходит', () => {
    const w = { storeOrderId: 'so-1', status: 'confirmed', lines: baseProof.lines, confirmedTotal: 5000, deliveryEta: '2026-10-09T15:00:00Z' };
    expect(StoreWebhook.safeParse(w).success).toBe(false);
  });

  it('rejected с причиной проходит', () => {
    expect(StoreWebhook.safeParse({ storeOrderId: 'so-1', status: 'rejected', reason: 'out_of_stock' }).success).toBe(true);
  });
});
