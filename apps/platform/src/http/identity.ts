import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthService } from '../auth/service.js';
import type { Identity } from '../events/query.js';

export const SESSION_COOKIE = 'sid';

/** Фоллбэк для агентов/e2e/curl: x-role и спутники. Limitations: заголовки не подписаны. */
export function identityFromHeaders(req: FastifyRequest): Identity | undefined {
  const role = req.headers['x-role'];
  if (role === 'admin') return { role: 'admin' };
  if (role === 'buyer') {
    const userId = req.headers['x-user-id'];
    return typeof userId === 'string' && userId ? { role: 'buyer', userId } : undefined;
  }
  if (role === 'provider') {
    const providerId = req.headers['x-provider-id'];
    return typeof providerId === 'string' && providerId ? { role: 'provider', providerId } : undefined;
  }
  return undefined;
}

/** Идентичность запроса: сессия (cookie sid, активная учётка) -> заголовки. */
export async function resolveIdentity(req: FastifyRequest, auth?: AuthService): Promise<Identity | undefined> {
  const sid = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies?.[SESSION_COOKIE];
  if (sid && auth) {
    const found = await auth.identity(sid);
    if (found) return found.identity;
  }
  return identityFromHeaders(req);
}

/** Разделы по роли: нет идентичности -> 401, не та роль -> 403 (C34). */
export function requireRole(auth: AuthService | undefined, role: Identity['role']) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const identity = await resolveIdentity(req, auth);
    if (!identity) return reply.code(401).send({ error: 'unauthenticated' });
    if (identity.role !== role) return reply.code(403).send({ error: 'forbidden', need: role, have: identity.role });
  };
}
