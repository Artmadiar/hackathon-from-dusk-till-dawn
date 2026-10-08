import { createApp } from '@fdtd/shared';

const app = createApp({
  service: 'buyer-agent',
  health: { llm: process.env.LLM ?? 'fake' },
});
const port = Number(process.env.PORT ?? 3381);
await app.listen({ port, host: '0.0.0.0' });
