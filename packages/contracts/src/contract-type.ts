import type { ZodType } from 'zod';

export type Severity = 'error' | 'warning';

export interface Violation {
  code: string;
  severity: Severity;
  message: string;
  itemIndex?: number;
  sku?: string;
}

/** Точка расширения №1 (концепт 3.2): домен = тип контракта. */
export interface ContractType<R, Q, P> {
  id: string;
  requestSchema: ZodType<R>;
  quoteSchema: ZodType<Q>;
  proofSchema: ZodType<P>;
  /** У заказчика, до холда. `now` инжектируется (plan 1.4). */
  validateQuote(req: R, quote: Q, now: Date): Violation[];
  /** У заказчика, до расчёта. */
  validateProof(quote: Q, proof: P): Violation[];
}
