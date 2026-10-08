import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyJwt, type Clock } from '@fdtd/shared';

/**
 * Агенты -> платформа: JWT HS256 (B8), aud=platform,
 * iss='buyer-agent' или 'provider-agent:{providerId}'.
 */
export interface AgentIdentity {
  iss: string;
  providerId?: string;
}

export function agentAuth(opts: { jwtSecret: string; clock: Clock }) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    try {
      if (!token) throw new Error('missing token');
      const payloadB64 = token.split('.')[1] ?? '';
      const { iss } = JSON.parse(Buffer.from(payloadB64, 'base64url').toString()) as { iss?: string };
      if (iss !== 'buyer-agent' && !iss?.startsWith('provider-agent:')) throw new Error('unknown issuer');
      verifyJwt(token, opts.jwtSecret, { iss, aud: 'platform', clock: opts.clock });
      (req as FastifyRequest & { agent: AgentIdentity }).agent = {
        iss,
        providerId: iss.startsWith('provider-agent:') ? iss.slice('provider-agent:'.length) : undefined,
      };
    } catch {
      await reply.code(401).send({ error: 'unauthorized' });
    }
  };
}
