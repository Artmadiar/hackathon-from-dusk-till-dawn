import { createApp } from '@fdtd/shared';

const app = createApp({ service: 'platform' });
const port = Number(process.env.PORT ?? 3380);
await app.listen({ port, host: '0.0.0.0' });
