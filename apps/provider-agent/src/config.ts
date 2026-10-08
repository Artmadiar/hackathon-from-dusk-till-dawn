import { z } from 'zod';

/**
 * Правила исполнителя — конфигурация при онбординге (концепт 3.4):
 * minOrderTotal, markupPct, etaBufferDays + расписание магазина для срока (B7).
 * Расписание — знание агента о своём магазине, не часть контракта K6.
 */
export const Schedule = z.discriminatedUnion('type', [
  z.object({ type: z.literal('weekdays'), days: z.array(z.number().int().min(1).max(7)).min(1) }),
  z.object({ type: z.literal('leadDays'), days: z.number().int().nonnegative() }),
]);
export type Schedule = z.infer<typeof Schedule>;

export const AgentRules = z.object({
  minOrderTotal: z.number().int().nonnegative().default(0),
  markupPct: z.number().nonnegative().default(0),
  etaBufferDays: z.number().int().nonnegative().default(0),
  schedule: Schedule,
  /** Оферта действительна N минут (validUntil). */
  quoteValidForMin: z.number().int().positive().default(60),
  /** Таймаут ожидания webhook магазина; его держит исполнитель (B1, C20). */
  storeTimeoutMs: z.number().int().positive().default(60_000),
});
export type AgentRules = z.infer<typeof AgentRules>;

/** Дефолты демо-исполнителей (роли магазинов — концепт 3.3). */
const DEFAULTS: Record<string, z.input<typeof AgentRules>> = {
  aqua: { schedule: { type: 'weekdays', days: [2, 4] }, markupPct: 10, minOrderTotal: 500 },
  papirna: { schedule: { type: 'leadDays', days: 1 }, etaBufferDays: 1, markupPct: 15, minOrderTotal: 1000 },
  kancelar: { schedule: { type: 'leadDays', days: 2 }, etaBufferDays: 1, markupPct: 5, minOrderTotal: 500 },
  levny: { schedule: { type: 'leadDays', days: 7 }, markupPct: 0, minOrderTotal: 2000 },
};

/** PROVIDER_ID выбирает дефолты; AGENT_RULES (JSON) точечно переопределяет. */
export function rulesFromEnv(providerId: string, env: NodeJS.ProcessEnv = process.env): AgentRules {
  const base = DEFAULTS[providerId] ?? { schedule: { type: 'leadDays', days: 2 } };
  const override = env.AGENT_RULES ? JSON.parse(env.AGENT_RULES) as Record<string, unknown> : {};
  return AgentRules.parse({ ...base, ...override });
}
