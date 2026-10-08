import Anthropic from '@anthropic-ai/sdk';

/** Интерфейс Llm един для обоих агентов; в тестах FakeLlm (B10, plan 1.3). */
export interface LlmToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>; // JSON Schema (из Zod, U4)
}

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  system?: string;
  messages: LlmMessage[];
  tools?: LlmToolDef[];
  maxTokens?: number;
}

export interface LlmToolUse {
  name: string;
  input: unknown;
}

export interface LlmResult {
  text: string;
  toolUses: LlmToolUse[];
}

export interface Llm {
  complete(req: LlmRequest): Promise<LlmResult>;
}

export class AnthropicLlm implements Llm {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(opts: { apiKey?: string; model?: string } = {}) {
    this.client = new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {});
    this.model = opts.model ?? 'claude-sonnet-5-5'; // N3
  }

  async complete(req: LlmRequest): Promise<LlmResult> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: req.maxTokens ?? 1024,
      temperature: 0, // N3
      ...(req.system ? { system: req.system } : {}),
      messages: req.messages,
      ...(req.tools ? { tools: req.tools as Anthropic.Tool[] } : {}),
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    const toolUses = res.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      .map((b) => ({ name: b.name, input: b.input }));
    return { text, toolUses };
  }
}

/** Табличный фейк: первое правило, чья подстрока встречается в промпте (plan 1.3). */
export interface FakeLlmRule {
  when: string;
  text?: string;
  toolUses?: LlmToolUse[];
}

export class FakeLlm implements Llm {
  readonly calls: LlmRequest[] = [];

  constructor(private readonly rules: FakeLlmRule[]) {}

  async complete(req: LlmRequest): Promise<LlmResult> {
    this.calls.push(req);
    const haystack = [req.system ?? '', ...req.messages.map((m) => m.content)]
      .join('\n')
      .toLowerCase();
    const rule = this.rules.find((r) => haystack.includes(r.when.toLowerCase()));
    if (!rule) {
      const known = this.rules.map((r) => JSON.stringify(r.when)).join(', ');
      throw new Error(`FakeLlm: no rule matches prompt; known rules: [${known}]`);
    }
    return { text: rule.text ?? '', toolUses: rule.toolUses ?? [] };
  }
}

/** LLM=real|fake (по умолчанию fake — поднимается без ключа, B10/B11). */
export function llmFromEnv(env: NodeJS.ProcessEnv = process.env): Llm {
  if (env.LLM === 'real') {
    return new AnthropicLlm({ apiKey: env.ANTHROPIC_API_KEY });
  }
  return new FakeLlm([]);
}
