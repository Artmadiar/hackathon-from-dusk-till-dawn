import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Clock } from './clock.js';
import { systemClock } from './clock.js';

/**
 * Подпись webhook магазин -> агент: HMAC + timestamp + nonce, как у Stripe (B8).
 * Заголовок: `t=<unix>,n=<nonce>,v1=<hex>`; подписывается `${t}.${n}.${body}`.
 * Защиту от повтора nonce держит получатель (C24).
 */

export function signWebhook(
  body: string,
  secret: string,
  opts: { clock?: Clock; nonce?: string } = {},
): string {
  const t = Math.floor((opts.clock ?? systemClock).now().getTime() / 1000);
  const n = opts.nonce ?? randomBytes(8).toString('hex');
  const v1 = createHmac('sha256', secret).update(`${t}.${n}.${body}`).digest('hex');
  return `t=${t},n=${n},v1=${v1}`;
}

export type WebhookVerification =
  | { ok: true; timestamp: number; nonce: string }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'stale_timestamp' };

export function verifyWebhook(
  body: string,
  header: string | undefined,
  secret: string,
  opts: { clock?: Clock; toleranceSec?: number } = {},
): WebhookVerification {
  if (!header) return { ok: false, reason: 'malformed' };
  const parts = Object.fromEntries(
    header.split(',').map((kv) => kv.split('=', 2) as [string, string]),
  ) as Record<string, string | undefined>;
  const t = Number(parts.t);
  const n = parts.n;
  const v1 = parts.v1;
  if (!Number.isInteger(t) || !n || !v1) return { ok: false, reason: 'malformed' };

  const expected = createHmac('sha256', secret).update(`${t}.${n}.${body}`).digest('hex');
  const a = Buffer.from(v1);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' };

  const now = Math.floor((opts.clock ?? systemClock).now().getTime() / 1000);
  const tolerance = opts.toleranceSec ?? 300;
  if (Math.abs(now - t) > tolerance) return { ok: false, reason: 'stale_timestamp' };

  return { ok: true, timestamp: t, nonce: n };
}
