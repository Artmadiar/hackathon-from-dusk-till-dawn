import { createApp } from '@fdtd/shared';

const providerId = process.env.PROVIDER_ID ?? 'unknown';
const app = createApp({
  service: `provider-agent:${providerId}`,
  health: { providerId, storeUrl: process.env.STORE_URL ?? null },
});
const port = Number(process.env.PORT ?? 3382);
await app.listen({ port, host: '0.0.0.0' });
