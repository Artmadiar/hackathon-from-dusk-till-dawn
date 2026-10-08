import { describe, expect, it } from 'vitest';
import {
  FakeLlm, JwtError, MemoryEventWriter, clockFromEnv, fixedClock, seqIdGen,
  signJwt, signWebhook, verifyJwt, verifyWebhook,
} from '../src/index.js';

const clock = fixedClock('2026-10-08T12:00:00Z');

describe('clock / ids', () => {
  it('fixedClock и clockFromEnv(fixed:...) возвращают одно и то же время', () => {
    expect(clock.now().toISOString()).toBe('2026-10-08T12:00:00.000Z');
    expect(clockFromEnv('fixed:2026-10-09T09:00:00Z').now().toISOString()).toBe('2026-10-09T09:00:00.000Z');
  });

  it('seqIdGen детерминирован по префиксу', () => {
    const ids = seqIdGen();
    expect([ids.next('task'), ids.next('task'), ids.next('deal')]).toEqual(['task-1', 'task-2', 'deal-1']);
  });
});

describe('jwt (B8)', () => {
  const opts = { iss: 'platform', aud: 'provider-agent', expiresInSec: 60, clock };

  it('round trip', () => {
    const token = signJwt({ sub: 'provider:papirna' }, 's3cret', opts);
    const claims = verifyJwt(token, 's3cret', { iss: 'platform', aud: 'provider-agent', clock });
    expect(claims.sub).toBe('provider:papirna');
  });

  it('неверный секрет -> bad_signature', () => {
    const token = signJwt({}, 's3cret', opts);
    expect(() => verifyJwt(token, 'other', { iss: 'platform', aud: 'provider-agent', clock }))
      .toThrowError(JwtError);
  });

  it('истёкший токен -> expired', () => {
    const token = signJwt({}, 's3cret', opts);
    const later = fixedClock('2026-10-08T12:02:00Z');
    expect(() => verifyJwt(token, 's3cret', { iss: 'platform', aud: 'provider-agent', clock: later }))
      .toThrowError(/expired/);
  });

  it('чужой aud -> bad_claim', () => {
    const token = signJwt({}, 's3cret', opts);
    expect(() => verifyJwt(token, 's3cret', { iss: 'platform', aud: 'buyer-agent', clock }))
      .toThrowError(/aud/);
  });
});

describe('webhook hmac (B8, C24)', () => {
  const body = '{"storeOrderId":"so-1","status":"confirmed"}';

  it('round trip', () => {
    const header = signWebhook(body, 'whsec', { clock, nonce: 'abc' });
    expect(verifyWebhook(body, header, 'whsec', { clock })).toEqual({ ok: true, timestamp: 1791460800, nonce: 'abc' });
  });

  it('подменённое тело -> bad_signature', () => {
    const header = signWebhook(body, 'whsec', { clock });
    expect(verifyWebhook(body + 'x', header, 'whsec', { clock })).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('старый timestamp -> stale_timestamp', () => {
    const header = signWebhook(body, 'whsec', { clock });
    const later = fixedClock('2026-10-08T12:10:00Z');
    expect(verifyWebhook(body, header, 'whsec', { clock: later })).toEqual({ ok: false, reason: 'stale_timestamp' });
  });

  it('нет заголовка -> malformed', () => {
    expect(verifyWebhook(body, undefined, 'whsec', { clock })).toEqual({ ok: false, reason: 'malformed' });
  });
});

describe('events (3.8)', () => {
  it('MemoryEventWriter нумерует монотонно и ставит ts из clock', async () => {
    const w = new MemoryEventWriter(clock);
    await w.emit({ kind: 'domain', actor: 'platform', type: 'TASK_CREATED', taskId: 't-1' });
    await w.emit({ kind: 'agent', actor: 'buyer-agent', type: 'DECISION', runId: 'r-1' });
    expect(w.events.map((e) => e.id)).toEqual([1, 2]);
    expect(w.events[0]!.ts).toBe('2026-10-08T12:00:00.000Z');
    expect(w.types).toEqual(['TASK_CREATED', 'DECISION']);
  });
});

describe('FakeLlm (B10)', () => {
  it('подбирает правило по подстроке и пишет вызовы', async () => {
    const llm = new FakeLlm([
      { when: 'бумага', toolUses: [{ name: 'pick_sku', input: { sku: 'A4-80' } }] },
      { when: 'вода', text: 'AQUA-19' },
    ]);
    const res = await llm.complete({ messages: [{ role: 'user', content: 'Подбери товар: бумага A4' }] });
    expect(res.toolUses).toEqual([{ name: 'pick_sku', input: { sku: 'A4-80' } }]);
    expect(llm.calls).toHaveLength(1);
  });

  it('нет правила -> понятная ошибка', async () => {
    const llm = new FakeLlm([{ when: 'вода', text: 'x' }]);
    await expect(llm.complete({ messages: [{ role: 'user', content: 'скрепки' }] }))
      .rejects.toThrowError(/no rule matches/);
  });
});
