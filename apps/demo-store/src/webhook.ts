import type { StoreWebhook } from '@fdtd/contracts';
import { signWebhook, type Clock } from '@fdtd/shared';

/**
 * Единственный webhook магазина (K7): POST на URL агента-исполнителя,
 * подпись HMAC + timestamp + nonce (заголовок x-store-signature),
 * ретраи с backoff при 5xx и сетевых ошибках; 4xx — не ретраим.
 */
export interface WebhookSenderOpts {
  url: string;
  secret: string;
  clock: Clock;
  /** Паузы между попытками; длина = число ретраев. */
  backoffMs?: number[];
  fetchFn?: typeof fetch;
  log?: { info: (o: unknown, msg: string) => void; warn: (o: unknown, msg: string) => void; error: (o: unknown, msg: string) => void };
}

export const SIGNATURE_HEADER = 'x-store-signature';

export interface WebhookSender {
  /** fire-and-forget: магазин асинхронный, ответ заказа не ждёт webhook. */
  send(payload: StoreWebhook): Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createWebhookSender(opts: WebhookSenderOpts): WebhookSender {
  const backoff = opts.backoffMs ?? [1_000, 3_000, 9_000];
  const doFetch = opts.fetchFn ?? fetch;
  const log = opts.log ?? { info: () => {}, warn: () => {}, error: () => {} };

  return {
    async send(payload) {
      const body = JSON.stringify(payload);
      for (let attempt = 0; attempt <= backoff.length; attempt++) {
        /* подпись на каждую попытку — свежий timestamp и nonce */
        const signature = signWebhook(body, opts.secret, { clock: opts.clock });
        try {
          const res = await doFetch(opts.url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', [SIGNATURE_HEADER]: signature },
            body,
          });
          if (res.ok) {
            log.info({ storeOrderId: payload.storeOrderId, status: payload.status, attempt }, 'webhook delivered');
            return;
          }
          if (res.status < 500) {
            log.warn({ storeOrderId: payload.storeOrderId, httpStatus: res.status }, 'webhook rejected by receiver, giving up');
            return;
          }
          log.warn({ storeOrderId: payload.storeOrderId, httpStatus: res.status, attempt }, 'webhook 5xx');
        } catch (err) {
          log.warn({ storeOrderId: payload.storeOrderId, err: String(err), attempt }, 'webhook network error');
        }
        if (attempt < backoff.length) await sleep(backoff[attempt]);
      }
      log.error({ storeOrderId: payload.storeOrderId }, 'webhook delivery failed after retries');
    },
  };
}
