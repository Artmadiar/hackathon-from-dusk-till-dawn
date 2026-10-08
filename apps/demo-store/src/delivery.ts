import type { Delivery } from './seed.js';

/** ISO-день недели в UTC: 1=пн … 7=вс. */
function isoWeekdayUtc(d: Date): number {
  const w = d.getUTCDay();
  return w === 0 ? 7 : w;
}

/**
 * Абсолютный срок доставки из расписания магазина (B7, C15):
 * weekdays — ближайший следующий день из списка (строго после сегодня),
 * leadDays — через N дней. Время — 15:00 UTC.
 */
export function nextDeliveryEta(delivery: Delivery, now: Date): string {
  const at = (daysAhead: number): string => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysAhead, 15, 0, 0));
    return d.toISOString();
  };
  if (delivery.type === 'leadDays') return at(delivery.days);
  for (let ahead = 1; ahead <= 7; ahead++) {
    const candidate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + ahead));
    if (delivery.days.includes(isoWeekdayUtc(candidate))) return at(ahead);
  }
  /* unreachable: список дней непуст */
  return at(7);
}
