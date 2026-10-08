import { and, arrayContains, desc, eq } from 'drizzle-orm';
import type { Clock, EventWriter } from '@fdtd/shared';
import type { Db } from '../db/client.js';
import { providers, type Provider } from '../db/schema.js';

export class RegistryService {
  constructor(
    private readonly db: Db,
    private readonly events: EventWriter,
    private readonly clock: Clock,
  ) {}

  async upsert(input: {
    id: string;
    name: string;
    agentUrl: string;
    categories: string[];
    ratingX100?: number;
    contractTypeId?: string;
    active?: boolean;
  }): Promise<Provider> {
    const values = {
      ...input,
      contractTypeId: input.contractTypeId ?? 'office-supplies.v1',
      ratingX100: input.ratingX100 ?? 400,
      active: input.active ?? true,
      createdAt: this.clock.now(),
    };
    const existing = await this.get(input.id);
    const [inserted] = existing
      ? await this.db.update(providers).set({
          name: values.name, agentUrl: values.agentUrl, categories: values.categories,
          contractTypeId: values.contractTypeId, active: values.active,
        }).where(eq(providers.id, input.id)).returning()
      : await this.db.insert(providers).values(values).returning();
    if (!existing) {
      await this.events.emit({
        kind: 'domain', actor: 'platform', type: 'PROVIDER_ONBOARDED',
        providerId: inserted!.id,
        payload: { name: inserted!.name, categories: inserted!.categories, rating: inserted!.ratingX100 / 100 },
      });
    }
    return inserted!;
  }

  async get(id: string): Promise<Provider | undefined> {
    const [p] = await this.db.select().from(providers).where(eq(providers.id, id));
    return p;
  }

  async list(): Promise<Provider[]> {
    return this.db.select().from(providers).orderBy(desc(providers.ratingX100));
  }

  /** Discovery: исполнители, чьи categories покрывают ВСЕ категории задачи (3.2, C31). */
  async discover(input: {
    contractTypeId: string;
    categories: string[];
    excludeIds?: string[];
  }): Promise<Provider[]> {
    const found = await this.db.select().from(providers)
      .where(and(
        eq(providers.contractTypeId, input.contractTypeId),
        eq(providers.active, true),
        arrayContains(providers.categories, input.categories),
      ))
      .orderBy(desc(providers.ratingX100));
    const exclude = new Set(input.excludeIds ?? []);
    return found.filter((p) => !exclude.has(p.id));
  }

  /**
   * Рейтинг 3.3.1: SETTLED +0.05, OFFER_WITHDRAWN -0.3, DEAL_CANCELLED по вине исполнителя -0.5.
   * Хранится в сотых, клэмп 0..500.
   */
  async changeRating(
    providerId: string,
    deltaX100: number,
    reason: string,
    refs: { dealId?: string; taskId?: string } = {},
  ): Promise<{ before: number; after: number }> {
    const { before, after } = await this.db.transaction(async (tx) => {
      const [p] = await tx.select().from(providers).where(eq(providers.id, providerId)).for('update');
      if (!p) throw new Error(`provider ${providerId} not found`);
      const next = Math.min(500, Math.max(0, p.ratingX100 + deltaX100));
      await tx.update(providers).set({ ratingX100: next }).where(eq(providers.id, providerId));
      return { before: p.ratingX100, after: next };
    });
    await this.events.emit({
      kind: 'domain', actor: 'platform', type: 'RATING_CHANGED',
      providerId, ...refs,
      payload: { before: before / 100, after: after / 100, delta: deltaX100 / 100, reason },
    });
    return { before, after };
  }
}

export const RATING_DELTA = {
  settled: 5,
  offerWithdrawn: -30,
  cancelledProviderFault: -50,
} as const;
