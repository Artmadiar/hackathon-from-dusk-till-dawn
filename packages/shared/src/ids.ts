import { randomUUID } from 'node:crypto';

/** Генерация id инжектируется (plan 1.4). */
export interface IdGen {
  next(prefix?: string): string;
}

export const uuidIdGen: IdGen = {
  next: (prefix) => (prefix ? `${prefix}-${randomUUID()}` : randomUUID()),
};

/** Детерминированный генератор для тестов: task-1, task-2, ... */
export function seqIdGen(): IdGen {
  const counters = new Map<string, number>();
  return {
    next(prefix = 'id') {
      const n = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, n);
      return `${prefix}-${n}`;
    },
  };
}
