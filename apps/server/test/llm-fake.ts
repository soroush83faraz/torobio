import { LlmError, type LlmClient, type LlmErrorKind, type LlmRequest } from '../src/llm/client.js';

export interface FakeBehaviour {
  /** The model's text, or a function of the request (e.g. echo the prompt). */
  reply?: string | ((req: LlmRequest) => string);
  /** Answer after this delay. The fake IGNORES aborts (like a slow network): the late answer still arrives. */
  delayMs?: number;
  /** Throw this LlmError kind (after the delay, if any). */
  fail?: LlmErrorKind;
  /** What available() reports (default true). */
  available?: boolean;
}

/** LlmClient test double: no network, records every request, configurable reply / delay / failure. */
export class FakeLlmClient implements LlmClient {
  readonly configured = true;
  readonly model = 'fake-model';
  readonly calls: LlmRequest[] = [];
  aborted = 0;
  finished = 0;

  constructor(private behaviour: FakeBehaviour = {}) {}

  set(b: FakeBehaviour): this {
    this.behaviour = b;
    return this;
  }

  available(): boolean {
    return this.behaviour.available ?? true;
  }

  async complete(req: LlmRequest): Promise<string> {
    this.calls.push(req);
    const b = this.behaviour;
    req.signal?.addEventListener('abort', () => (this.aborted += 1), { once: true });
    if (b.delayMs) await new Promise((r) => setTimeout(r, b.delayMs));
    this.finished += 1;
    if (b.fail) throw new LlmError(b.fail);
    const r = b.reply ?? '';
    return typeof r === 'function' ? r(req) : r;
  }

  get last(): LlmRequest | undefined {
    return this.calls[this.calls.length - 1];
  }
}
