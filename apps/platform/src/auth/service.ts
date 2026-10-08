import { randomInt, randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Clock } from '@fdtd/shared';
import type { Db } from '../db/client.js';
import { otpCodes, sessions, users, type Session, type User } from '../db/schema.js';
import type { Identity } from '../events/query.js';

export class AuthError extends Error {
  constructor(readonly code: 'invalid_code' | 'expired_code' | 'no_session' | 'not_in_session', message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface SessionView {
  id: string;
  activeIdentity: string;
  identities: Array<Pick<User, 'id' | 'email' | 'role' | 'name' | 'providerId' | 'apiKey'>>;
  expiresAt: string;
}

const OTP_TTL_MS = 10 * 60_000;
const SESSION_TTL_MS = 7 * 24 * 3_600_000;

/** B8: OTP-вход (код SIMULATED, по email не уходит), сессия с несколькими учётками. */
export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    /** инжектируется в тестах; по умолчанию 6 цифр */
    private readonly codeGen: () => string = () => String(randomInt(0, 1_000_000)).padStart(6, '0'),
  ) {}

  /** Неизвестный email — регистрация заказчика на лету (концепт: «заказчик регистрируется»). */
  async requestOtp(email: string): Promise<{ code: string; expiresAt: Date; user: User }> {
    const normalized = email.trim().toLowerCase();
    const user = await this.findOrCreateUser(normalized);
    const code = this.codeGen();
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + OTP_TTL_MS);
    await this.db.insert(otpCodes).values({ email: normalized, code, expiresAt, createdAt: now });
    return { code, expiresAt, user };
  }

  /** Код одноразовый, с TTL (C34). sessionId добавляет учётку в существующую сессию. */
  async verifyOtp(input: { email: string; code: string; sessionId?: string }): Promise<SessionView> {
    const normalized = input.email.trim().toLowerCase();
    const now = this.clock.now();
    const [row] = await this.db.select().from(otpCodes)
      .where(and(eq(otpCodes.email, normalized), eq(otpCodes.code, input.code), isNull(otpCodes.consumedAt)))
      .orderBy(desc(otpCodes.id)).limit(1);
    if (!row) throw new AuthError('invalid_code', 'no such unconsumed code');
    if (row.expiresAt.getTime() <= now.getTime()) throw new AuthError('expired_code', 'OTP expired');
    await this.db.update(otpCodes).set({ consumedAt: now }).where(eq(otpCodes.id, row.id));

    const [user] = await this.db.select().from(users).where(eq(users.email, normalized));
    if (!user) throw new AuthError('invalid_code', 'user disappeared');

    const existing = input.sessionId ? await this.sessionRow(input.sessionId) : undefined;
    if (existing) {
      const identities = existing.identities.includes(user.id)
        ? existing.identities
        : [...existing.identities, user.id];
      await this.db.update(sessions).set({ identities, activeIdentity: user.id })
        .where(eq(sessions.id, existing.id));
      return this.view({ ...existing, identities, activeIdentity: user.id });
    }
    const session: Session = {
      id: randomUUID(),
      identities: [user.id],
      activeIdentity: user.id,
      createdAt: now,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    };
    await this.db.insert(sessions).values(session);
    return this.view(session);
  }

  async getSession(sessionId: string): Promise<SessionView | undefined> {
    const row = await this.sessionRow(sessionId);
    return row ? this.view(row) : undefined;
  }

  async switchIdentity(sessionId: string, userId: string): Promise<SessionView> {
    const row = await this.sessionRow(sessionId);
    if (!row) throw new AuthError('no_session', 'session not found or expired');
    if (!row.identities.includes(userId)) throw new AuthError('not_in_session', `identity ${userId} is not in session`);
    await this.db.update(sessions).set({ activeIdentity: userId }).where(eq(sessions.id, row.id));
    return this.view({ ...row, activeIdentity: userId });
  }

  async logout(sessionId: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.id, sessionId));
  }

  /** Активная учётка сессии -> идентичность для фильтра журнала (R8). */
  async identity(sessionId: string): Promise<{ identity: Identity; user: User } | undefined> {
    const row = await this.sessionRow(sessionId);
    if (!row) return undefined;
    const [user] = await this.db.select().from(users).where(eq(users.id, row.activeIdentity));
    if (!user) return undefined;
    return { identity: identityOf(user), user };
  }

  /** MCP: API-ключ в заголовке (B8). */
  async userByApiKey(apiKey: string): Promise<User | undefined> {
    const [user] = await this.db.select().from(users).where(eq(users.apiKey, apiKey));
    return user;
  }

  private async findOrCreateUser(email: string): Promise<User> {
    const [existing] = await this.db.select().from(users).where(eq(users.email, email));
    if (existing) return existing;
    const now = this.clock.now();
    const [created] = await this.db.insert(users).values({
      id: `user-${randomUUID().slice(0, 8)}`,
      email,
      role: 'buyer',
      name: email.split('@')[0] ?? email,
      apiKey: `ak-${randomUUID()}`,
      createdAt: now,
    }).onConflictDoNothing().returning();
    if (created) return created;
    const [raced] = await this.db.select().from(users).where(eq(users.email, email));
    return raced!;
  }

  private async sessionRow(id: string): Promise<Session | undefined> {
    const [row] = await this.db.select().from(sessions).where(eq(sessions.id, id));
    if (!row) return undefined;
    if (row.expiresAt.getTime() <= this.clock.now().getTime()) return undefined;
    return row;
  }

  private async view(row: Session): Promise<SessionView> {
    const members = row.identities.length
      ? await this.db.select().from(users).where(inArray(users.id, row.identities))
      : [];
    const byId = new Map(members.map((u) => [u.id, u]));
    return {
      id: row.id,
      activeIdentity: row.activeIdentity,
      // порядок — как добавляли; seed-сброс мог удалить пользователя — фильтруем
      identities: row.identities.flatMap((id) => {
        const u = byId.get(id);
        return u ? [{ id: u.id, email: u.email, role: u.role, name: u.name, providerId: u.providerId, apiKey: u.apiKey }] : [];
      }),
      expiresAt: row.expiresAt.toISOString(),
    };
  }
}

export function identityOf(user: User): Identity {
  if (user.role === 'admin') return { role: 'admin' };
  if (user.role === 'provider') return { role: 'provider', providerId: user.providerId ?? user.id };
  return { role: 'buyer', userId: user.id };
}
