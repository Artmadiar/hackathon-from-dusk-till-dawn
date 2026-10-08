import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Clock } from './clock.js';
import { systemClock } from './clock.js';

/** Платформа <-> агенты: короткоживущий JWT HS256 с iss/aud/exp (B8). */

export class JwtError extends Error {
  constructor(readonly code: 'malformed' | 'bad_signature' | 'expired' | 'bad_claim', message: string) {
    super(message);
    this.name = 'JwtError';
  }
}

const b64url = (buf: Buffer): string => buf.toString('base64url');

function hs256(input: string, secret: string): string {
  return b64url(createHmac('sha256', secret).update(input).digest());
}

export interface JwtOptions {
  iss: string;
  aud: string;
  expiresInSec: number;
  clock?: Clock;
}

export function signJwt(claims: Record<string, unknown>, secret: string, opts: JwtOptions): string {
  const clock = opts.clock ?? systemClock;
  const iat = Math.floor(clock.now().getTime() / 1000);
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = b64url(Buffer.from(JSON.stringify({
    ...claims,
    iss: opts.iss,
    aud: opts.aud,
    iat,
    exp: iat + opts.expiresInSec,
  })));
  const signature = hs256(`${header}.${payload}`, secret);
  return `${header}.${payload}.${signature}`;
}

export function verifyJwt(
  token: string,
  secret: string,
  opts: { iss: string; aud: string; clock?: Clock },
): Record<string, unknown> {
  const clock = opts.clock ?? systemClock;
  const parts = token.split('.');
  if (parts.length !== 3) throw new JwtError('malformed', 'expected 3 dot-separated parts');
  const [header, payload, signature] = parts as [string, string, string];

  const expected = hs256(`${header}.${payload}`, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new JwtError('bad_signature', 'signature mismatch');
  }

  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new JwtError('malformed', 'payload is not valid JSON');
  }

  if (claims.iss !== opts.iss) throw new JwtError('bad_claim', `iss: expected ${opts.iss}, got ${String(claims.iss)}`);
  if (claims.aud !== opts.aud) throw new JwtError('bad_claim', `aud: expected ${opts.aud}, got ${String(claims.aud)}`);
  const now = Math.floor(clock.now().getTime() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp <= now) throw new JwtError('expired', 'token expired');

  return claims;
}
