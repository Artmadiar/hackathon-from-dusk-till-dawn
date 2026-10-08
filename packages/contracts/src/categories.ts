import { z } from 'zod';

/** Фиксированный enum контракта office-supplies.v1 (концепт 3.2). */
export const CATEGORIES = ['paper', 'writing', 'water', 'office'] as const;
export const Category = z.enum(CATEGORIES);
export type Category = z.infer<typeof Category>;
