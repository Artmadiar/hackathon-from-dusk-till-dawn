import type { Schedule } from './config.js';

function isoWeekdayUtc(d: Date): number {
  const w = d.getUTCDay();
  return w === 0 ? 7 : w;
}

/**
 * B7, C15: абсолютный deliveryEta = расписание магазина + буфер агента.
 * weekdays — ближайший следующий день из списка, затем +буфер; leadDays — N+буфер дней.
 * Время 15:00 UTC, как обещает магазин.
 */
export function deliveryEta(schedule: Schedule, bufferDays: number, now: Date): string {
  const at = (daysAhead: number): string =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysAhead, 15, 0, 0)).toISOString();
  if (schedule.type === 'leadDays') return at(schedule.days + bufferDays);
  for (let ahead = 1; ahead <= 7; ahead++) {
    const candidate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + ahead));
    if (schedule.days.includes(isoWeekdayUtc(candidate))) return at(ahead + bufferDays);
  }
  return at(7 + bufferDays);
}
