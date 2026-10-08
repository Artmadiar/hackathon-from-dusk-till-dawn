import { AnthropicLlm, clockFromEnv, uuidIdGen } from '@fdtd/shared';
import { fakeBuyerLlm } from './fake-llm.js';
import { createBuyerAgent } from './app.js';
import { httpPlatform } from './http-platform.js';

const clock = clockFromEnv();
const jwtSecret = process.env.AGENT_JWT_SECRET ?? 'dev-agent-secret';

const { app } = createBuyerAgent({
  llm: process.env.LLM === 'real' ? new AnthropicLlm({ apiKey: process.env.ANTHROPIC_API_KEY }) : fakeBuyerLlm(),
  platform: httpPlatform({
    platformUrl: process.env.PLATFORM_URL ?? 'http://platform:3380',
    jwtSecret, clock,
  }),
  clock,
  idGen: uuidIdGen,
  jwtSecret,
});

const port = Number(process.env.PORT ?? 3381);
await app.listen({ port, host: '0.0.0.0' });
