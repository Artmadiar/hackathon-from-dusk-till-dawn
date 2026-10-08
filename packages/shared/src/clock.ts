/** Часы инжектируются в каждый сервис (plan 1.4, B7). */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export function fixedClock(iso: string | Date): Clock {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) throw new Error(`fixedClock: invalid date "${String(iso)}"`);
  return { now: () => new Date(t) };
}

/** CLOCK=real | fixed:2026-10-09T09:00:00Z (env 3.4) */
export function clockFromEnv(spec = process.env.CLOCK): Clock {
  if (!spec || spec === 'real') return systemClock;
  if (spec.startsWith('fixed:')) return fixedClock(spec.slice('fixed:'.length));
  throw new Error(`CLOCK: expected "real" or "fixed:<iso>", got "${spec}"`);
}
