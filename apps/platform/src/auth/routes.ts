import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthError, type AuthService } from './service.js';
import { SESSION_COOKIE } from '../http/identity.js';

export function registerAuthRoutes(app: FastifyInstance, deps: {
  auth: AuthService;
  /** Вызывается после verify для buyer-учётки: кошелёк + дефолтная политика (C36). */
  onBuyerVerified?: (userId: string) => Promise<void>;
}): void {
  const { auth } = deps;
  const cookieOpts = { path: '/', httpOnly: true, sameSite: 'lax' as const };

  /** Код не отправляется по email — возвращается в ответе с пометкой SIMULATED (B8). */
  app.post('/auth/otp', async (req, reply) => {
    const parsed = z.object({ email: z.string().email() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    const { code, expiresAt, user } = await auth.requestOtp(parsed.data.email);
    req.log.info({ email: user.email, code }, 'SIMULATED email: OTP code');
    return { simulated: true, note: 'SIMULATED email: code returned in response', code, expiresAt, email: user.email };
  });

  /** Верификация; с активной сессией — добавляет учётку в неё (C34). */
  app.post('/auth/verify', async (req, reply) => {
    const parsed = z.object({ email: z.string().email(), code: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    try {
      const session = await auth.verifyOtp({ ...parsed.data, sessionId: req.cookies?.[SESSION_COOKIE] });
      const verified = session.identities.find((i) => i.email === parsed.data.email.trim().toLowerCase());
      if (verified?.role === 'buyer' && deps.onBuyerVerified) await deps.onBuyerVerified(verified.id);
      reply.setCookie(SESSION_COOKIE, session.id, { ...cookieOpts, expires: new Date(session.expiresAt) });
      return { session };
    } catch (e) {
      if (e instanceof AuthError) return reply.code(401).send({ error: e.code });
      throw e;
    }
  });

  app.get('/auth/session', async (req, reply) => {
    const sid = req.cookies?.[SESSION_COOKIE];
    const session = sid ? await auth.getSession(sid) : undefined;
    if (!session) return reply.code(401).send({ error: 'no_session' });
    return { session };
  });

  app.post('/auth/switch', async (req, reply) => {
    const parsed = z.object({ userId: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    const sid = req.cookies?.[SESSION_COOKIE];
    if (!sid) return reply.code(401).send({ error: 'no_session' });
    try {
      return { session: await auth.switchIdentity(sid, parsed.data.userId) };
    } catch (e) {
      if (e instanceof AuthError) {
        return reply.code(e.code === 'not_in_session' ? 403 : 401).send({ error: e.code });
      }
      throw e;
    }
  });

  app.post('/auth/logout', async (req, reply) => {
    const sid = req.cookies?.[SESSION_COOKIE];
    if (sid) await auth.logout(sid);
    reply.clearCookie(SESSION_COOKIE, cookieOpts);
    return { ok: true };
  });
}
