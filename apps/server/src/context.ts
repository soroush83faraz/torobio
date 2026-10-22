import type { Config } from './config.js';
import type { Db } from './db.js';
import type { LlmClient } from './llm/client.js';
import type { LlmGate } from './llm/gate.js';
import type { ParseRefiner } from './parse/refine.js';

/** Shared dependencies handed to every route module. */
export interface AppContext {
  config: Config;
  db: Db;
  llm: LlmClient;
  /**
   * Optional LLM refinement of /api/parse (raced against config.llmTimeoutMs; see parse/refine.ts). buildApp sets
   * it to the Anthropic-backed refiner (llm/refiner.ts) when an LLM key is configured.
   */
  parseRefiner?: ParseRefiner;
  /**
   * Cost / abuse gate of every LLM call (per-client per-minute and daily, global daily, concurrency). buildApp
   * always sets it; when absent the LLM paths stay closed (fail closed).
   */
  llmGate?: LlmGate;
}
