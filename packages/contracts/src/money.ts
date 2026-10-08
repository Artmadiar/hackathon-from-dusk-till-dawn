import { z } from 'zod';

/** Деньги — только целые minor units (центы), R5. Конвертация десятичных — на границе агентов. */
export const Cents = z.number().int('money must be integer minor units (cents)').nonnegative();
export const PositiveInt = z.number().int().positive();
