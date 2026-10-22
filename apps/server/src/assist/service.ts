/**
 * The assistant's decision flow (one request -> at most one applied action):
 *   1. chip                      -> deterministic action
 *   2. text, exact chip phrase   -> deterministic action (no LLM call)
 *   3. text, LLM usable          -> LLM decision (raced against llmTimeoutMs; a late answer is discarded for good)
 *   4. otherwise / LLM failed    -> keyword match if any, else a calm Persian "unsupported" message
 * The LLM is optional everywhere: missing key, open circuit, spent budget, timeout, invalid JSON or ids outside the
 * facts all end in steps 4 with `degraded: true` (when a key is configured). LLM prose is shown only for
 * explain / unsupported and only after the post-check (guard.ts); everything else is templated.
 */
import type { Api } from '@app/core';
import { llmUsable, type LlmClient } from '../llm/client.js';
import type { LlmGate } from '../llm/gate.js';
import { untrustedText } from '../llm/sanitize.js';
import { applyAction, type ApplyEnv, type ApplyResult } from './apply.js';
import type { AssistFacts } from './facts.js';
import { checkProse, digitNumbers, type ProseEnv } from './guard.js';
import { ASSIST_MAX_TOKENS, ASSIST_OUTPUT_SCHEMA, ASSIST_SYSTEM, buildAssistPrompt, decodeDecision, type LlmDecision } from './interpret.js';
import { matchKeywords, shopChoices, type KeywordMatch } from './keywords.js';
import { msg } from './messages.js';
import { toClientState } from './state.js';
import { MAX_ASSIST_TEXT, type AssistAction, type AssistChoice, type AssistContext, type AssistRequest, type AssistResponse, type AssistSource } from './types.js';

export interface AssistDeps {
  llm: LlmClient;
  /** Per-client / global LLM budget. Missing = the LLM path is closed (fail closed). */
  gate?: LlmGate | undefined;
  clientKey: string;
  timeoutMs: number;
  now: Date;
  facts: AssistFacts;
  /** Deterministic parser for add_item: its items are added to the state verbatim. */
  parseItems?: ApplyEnv['parseItems'];
}

type State = Api.RequirementState;

const RACE_MARGIN_MS = 100;

function reply(
  state: State,
  o: { action?: AssistAction; newState?: State; changed?: boolean; supported: boolean; messageFa: string; source: AssistSource; degraded?: boolean; choices?: AssistChoice[] },
): AssistResponse {
  return {
    action: o.action ?? { type: 'none' },
    newState: toClientState(o.newState ?? state),
    changed: o.changed ?? false,
    supported: o.supported,
    messageFa: o.messageFa,
    message: o.messageFa,
    source: o.source,
    ...(o.degraded ? { degraded: true as const } : {}),
    ...(o.choices && o.choices.length ? { choices: o.choices } : {}),
  };
}

function fromApply(state: State, r: ApplyResult, source: AssistSource, degraded: boolean, messageOverride?: string): AssistResponse {
  if (r.ok) {
    const supported = r.action.type !== 'none';
    return reply(state, { action: r.action, newState: r.newState, changed: r.changed, supported, messageFa: messageOverride ?? r.messageFa, source, degraded });
  }
  return reply(state, { supported: false, messageFa: r.messageFa, source, degraded, ...(r.choices ? { choices: r.choices } : {}) });
}

/** «نزدیک‌تر به هم» is the fewest-stops plan, said in its own words (when the plan really changed). */
function closerMessage(r: ApplyResult, facts: AssistFacts): string | undefined {
  if (!r.ok || !r.changed) return undefined;
  const fewer = [...facts.alternatives].filter((x) => x.deltaStops < 0).sort((x, y) => x.deltaStops - y.deltaStops || x.deltaToman - y.deltaToman)[0];
  return fewer ? msg.fewest(true, -fewer.deltaStops, fewer.deltaToman) : undefined;
}

function fromKeyword(state: State, kw: KeywordMatch, env: ApplyEnv, degraded: boolean): AssistResponse {
  if (kw.kind === 'clarify') return reply(state, { supported: false, messageFa: kw.messageFa, source: 'keywords', degraded, choices: kw.choices });
  const r = applyAction(state, kw.action, env);
  return fromApply(state, r, 'keywords', degraded, kw.intent === 'closer' ? closerMessage(r, env.facts) : undefined);
}

function chipAction(req: AssistRequest, facts: AssistFacts): AssistAction | KeywordMatch {
  const ctx = req.context ?? {};
  switch (req.chip) {
    case 'cheaper':
      return { type: 'set_preference', preference: 'cheapest' };
    case 'closer':
    case 'fewer_stops':
      return { type: 'set_preference', preference: 'fewest_stops' };
    case 'only_open':
      return { type: 'only_open', value: true };
    case 'without_shop':
    default: {
      const shop = (ctx.shopId ? facts.stops.find((s) => s.shopId === ctx.shopId) : undefined) ?? (facts.stops.length === 1 ? facts.stops[0] : undefined);
      if (shop) return { type: 'exclude_shop', shopId: shop.shopId };
      if (facts.stops.length === 0) return { kind: 'clarify', intent: 'without_shop', messageFa: msg.noStops, choices: [], exact: true };
      return { kind: 'clarify', intent: 'without_shop', messageFa: msg.needsShop, exact: true, choices: shopChoices(facts.stops) };
    }
  }
}

/** Numbers / Latin words the post-checked prose may contain: values of this call's data and the user's text. */
export function proseEnv(facts: AssistFacts, userText: string): ProseEnv {
  const numbers = new Set<number>();
  const add = (n: number) => {
    if (Number.isFinite(n)) numbers.add(n);
  };
  const money = (v: number) => {
    add(v);
    add(Math.round(v / 1e3));
    add(Math.round(v / 1e5) / 10);
    add(Math.round(v / 1e6));
    add(Math.round(v / 1e8) / 10);
  };
  [facts.stopCount, facts.covered, facts.total, facts.items.length].forEach(add);
  money(facts.totalToman);
  for (const a of facts.alternatives) {
    money(Math.abs(a.deltaToman));
    add(Math.abs(a.deltaStops));
  }
  const texts: string[] = [userText, facts.reason, facts.totalLine ?? ''];
  for (const i of facts.items) {
    add(i.qty);
    texts.push(i.text, ...i.stated.map((s) => s.label));
  }
  for (const s of facts.stops) texts.push(s.shopName, s.mallName ?? '');
  for (const t of texts) digitNumbers(t).forEach(add);
  const latinWords = new Set<string>();
  for (const t of texts) for (const w of t.match(/[A-Za-z]+/g) ?? []) latinWords.add(w.toLowerCase());
  return { numbers, latinWords, secrets: [ASSIST_SYSTEM] };
}

type Interpretation = { status: 'decided'; decision: LlmDecision } | { status: 'failed' };

/** One LLM call raced against the budget. The late result of a timed-out call is aborted and never used. */
async function interpret(text: string, deps: AssistDeps, ctx: AssistContext): Promise<Interpretation> {
  if (!llmUsable(deps.llm) || !deps.gate) return { status: 'failed' };
  const ticket = deps.gate.acquire(deps.clientKey);
  if (!ticket.ok) return { status: 'failed' };
  const ac = new AbortController();
  let user: string;
  try {
    user = buildAssistPrompt(text, deps.facts, ctx);
  } catch {
    ticket.release();
    return { status: 'failed' };
  }
  const work = (async () => {
    try {
      const raw = await deps.llm.complete({
        op: 'assist',
        system: ASSIST_SYSTEM,
        user,
        schema: ASSIST_OUTPUT_SCHEMA,
        maxTokens: ASSIST_MAX_TOKENS,
        timeoutMs: Math.max(1, deps.timeoutMs - RACE_MARGIN_MS),
        signal: ac.signal,
      });
      return { ok: true as const, raw };
    } catch {
      return { ok: false as const };
    } finally {
      ticket.release();
    }
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), deps.timeoutMs);
  });
  const winner = await Promise.race([work, timeout]);
  clearTimeout(timer);
  if (winner === 'timeout') {
    ac.abort();
    return { status: 'failed' };
  }
  if (!winner.ok) return { status: 'failed' };
  let decision: LlmDecision | null;
  try {
    decision = decodeDecision(winner.raw, text, deps.facts);
  } catch {
    decision = null;
  }
  return decision ? { status: 'decided', decision } : { status: 'failed' };
}

function fromDecision(state: State, d: LlmDecision, env: ApplyEnv, text: string): AssistResponse {
  if (d.kind === 'action') return fromApply(state, applyAction(state, d.action, env), 'llm', false);
  const checked = checkProse(d.prose, proseEnv(env.facts, text));
  if (d.kind === 'explain') {
    return reply(state, { action: { type: 'explain' }, supported: true, messageFa: checked ?? msg.explain(env.facts), source: 'llm' });
  }
  return reply(state, { supported: false, messageFa: d.hintFa ?? checked ?? msg.unsupported, source: 'llm' });
}

export async function runAssist(req: AssistRequest, deps: AssistDeps): Promise<AssistResponse> {
  const state = req.state;
  const ctx = req.context ?? {};
  const env: ApplyEnv = { facts: deps.facts, now: deps.now, ...(deps.parseItems ? { parseItems: deps.parseItems } : {}) };

  if (req.chip) {
    const a = chipAction(req, deps.facts);
    if ('kind' in a) return fromKeyword(state, a, env, false);
    const r = applyAction(state, a, env);
    return fromApply(state, r, 'chip', false, req.chip === 'closer' ? closerMessage(r, deps.facts) : undefined);
  }

  const text = untrustedText(req.text ?? '', MAX_ASSIST_TEXT);
  if (!text) return reply(state, { supported: false, messageFa: msg.empty, source: 'none' });

  const kw = matchKeywords(text, deps.facts, ctx);
  if (kw?.exact) return fromKeyword(state, kw, env, false);

  let degraded = false;
  if (deps.llm.configured) {
    const it = await interpret(text, deps, ctx);
    if (it.status === 'decided') return fromDecision(state, it.decision, env, text);
    degraded = true;
  }
  if (kw) return fromKeyword(state, kw, env, degraded);
  return reply(state, { supported: false, messageFa: degraded ? msg.llmUnavailable : msg.unsupported, source: 'none', degraded });
}
