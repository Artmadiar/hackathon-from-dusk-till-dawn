import { validateQuote, type Quote, type Req, type Violation } from '@fdtd/contracts';

/**
 * Правило ранжирования — в коде, не у LLM (концепт 3.6):
 * 1) нарушители validateQuote (error) — вне списка с причиной;
 * 2) ценовая аномалия при оценённом бюджете (R2: total > max×2) — вне списка;
 * 3) score = rating×0.5 + match×0.3 + цена×0.2; предпочтение +0.5;
 *    выше мягкого бюджета — штраф (R2).
 */
export const WEIGHTS = { rating: 0.5, match: 0.3, price: 0.2, preference: 0.5, aboveEstimatePenalty: 0.2 } as const;

export interface RankCandidate {
  dealId: string;
  providerId: string;
  rating: number; // 0–5
  quote: Quote;
}

export interface RankedQuote extends RankCandidate {
  score: number;
  match: number;
  priceAdvantage: number;
  preferred: boolean;
  aboveEstimate: boolean;
}

export interface ExcludedQuote {
  providerId: string;
  dealId: string;
  reason: string;
  violations?: Violation[];
  /** На каких числах принято решение — чтобы UI мог объяснить отсев. */
  total?: number;
  limit?: number;
}

export interface RankResult {
  ranked: RankedQuote[];
  excluded: ExcludedQuote[];
}

export function rankQuotes(opts: {
  req: Req;
  candidates: RankCandidate[];
  matches: Map<string, number>; // providerId -> 0–1 (LLM)
  preferredProviderIds: string[];
  now: Date;
}): RankResult {
  const { req, now } = opts;
  const excluded: ExcludedQuote[] = [];
  const eligible: Array<RankCandidate & { aboveEstimate: boolean }> = [];

  for (const c of opts.candidates) {
    const violations = validateQuote(req, c.quote, now);
    const errors = violations.filter((v) => v.severity === 'error');
    if (errors.length > 0) {
      excluded.push({ providerId: c.providerId, dealId: c.dealId, total: c.quote.total,
        reason: errors.map((v) => v.code).join(','), violations: errors });
      continue;
    }
    const soft = req.budget.source === 'estimated';
    if (soft && c.quote.total > req.budget.max * 2) {
      excluded.push({ providerId: c.providerId, dealId: c.dealId, reason: 'price_anomaly',
        total: c.quote.total, limit: req.budget.max * 2 });
      continue;
    }
    eligible.push({ ...c, aboveEstimate: soft && c.quote.total > req.budget.max });
  }

  const totals = eligible.map((c) => c.quote.total);
  const minT = Math.min(...totals);
  const maxT = Math.max(...totals);
  const priceAdvantage = (total: number): number => (maxT === minT ? 1 : (maxT - total) / (maxT - minT));

  const ranked = eligible.map((c): RankedQuote => {
    const match = opts.matches.get(c.providerId) ?? 0.5;
    const preferred = opts.preferredProviderIds.includes(c.providerId);
    const pa = priceAdvantage(c.quote.total);
    const score =
      c.rating * WEIGHTS.rating
      + match * WEIGHTS.match
      + pa * WEIGHTS.price
      + (preferred ? WEIGHTS.preference : 0)
      - (c.aboveEstimate ? WEIGHTS.aboveEstimatePenalty : 0);
    return { ...c, score: Math.round(score * 1000) / 1000, match, priceAdvantage: pa, preferred, aboveEstimate: c.aboveEstimate };
  }).sort((a, b) => b.score - a.score);

  return { ranked, excluded };
}
