import { createApp } from '@fdtd/shared';

const seed = process.env.SEED ?? 'none';
const app = createApp({
  service: `demo-store:${seed}`,
  health: { seed },
});
const port = Number(process.env.PORT ?? 3390);
await app.listen({ port, host: '0.0.0.0' });
