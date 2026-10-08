import type { Proof } from '@fdtd/contracts';
import { signJwt, type Clock, type NewEvent } from '@fdtd/shared';
import type { PlatformPort } from './ports.js';

/**
 * K5 по HTTP: агент -> платформа. Серверные маршруты появляются в S7
 * (агентский API платформы); контракт зафиксирован здесь.
 */
export function httpPlatform(opts: {
  platformUrl: string;
  providerId: string;
  jwtSecret: string;
  clock: Clock;
  fetchImpl?: typeof fetch;
}): PlatformPort {
  const base = opts.platformUrl.replace(/\/$/, '');
  const doFetch = opts.fetchImpl ?? fetch;

  const post = async (path: string, body: unknown): Promise<void> => {
    const token = signJwt({ providerId: opts.providerId }, opts.jwtSecret, {
      iss: `provider-agent:${opts.providerId}`, aud: 'platform', expiresInSec: 60, clock: opts.clock,
    });
    const res = await doFetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`platform ${path}: http ${res.status}`);
  };

  return {
    orderPlaced: (dealId, storeOrderRef) => post(`/agent/deals/${encodeURIComponent(dealId)}/order-placed`, { storeOrderRef }),
    submitProof: (dealId, proof: Proof) => post(`/agent/deals/${encodeURIComponent(dealId)}/proof`, { proof }),
    withdrawOffer: (dealId, reason) => post(`/agent/deals/${encodeURIComponent(dealId)}/withdraw`, { reason }),
    event: (e: NewEvent) => post('/agent/events', e),
  };
}
