export * from './contract-type.js';
export * from './categories.js';
export * from './money.js';
export * from './office-supplies.v1.js';
export * from './store-api.js';

import { officeSuppliesV1 } from './office-supplies.v1.js';

export const contractTypes = {
  [officeSuppliesV1.id]: officeSuppliesV1,
} as const;
