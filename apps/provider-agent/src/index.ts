import { AnthropicLlm, clockFromEnv, uuidIdGen } from '@fdtd/shared';
import { fakeProviderLlm } from './fake-llm.js';
import { createProviderAgent } from './app.js';
import { rulesFromEnv } from './config.js';
import { httpPlatform } from './http-platform.js';
import { httpStoreClient } from './store-client.js';

const providerId = process.env.PROVIDER_ID ?? 'unknown';
const clock = clockFromEnv();
const jwtSecret = process.env.AGENT_JWT_SECRET ?? 'dev-agent-secret';

const { app } = createProviderAgent({
  providerId,
  rules: rulesFromEnv(providerId),
  llm: process.env.LLM === 'real' ? new AnthropicLlm({ apiKey: process.env.ANTHROPIC_API_KEY }) : fakeProviderLlm(),
  store: httpStoreClient(process.env.STORE_URL ?? 'http://localhost:3390'),
  platform: httpPlatform({
    platformUrl: process.env.PLATFORM_URL ?? 'http://platform:3380',
    providerId, jwtSecret, clock,
  }),
  clock,
  idGen: uuidIdGen,
  jwtSecret,
  webhookSecret: process.env.WEBHOOK_SECRET ?? 'dev-webhook-secret',
});

const port = Number(process.env.PORT ?? 3382);
await app.listen({ port, host: '0.0.0.0' });
