# Security notes: public endpoint and LLM layer

Scope: `apps/server` (Fastify API + static web app) as deployed on a VPS as a single Docker container, with the
optional Anthropic LLM. Product rule this document protects: **the LLM only interprets words; the deterministic
engine decides; nothing the user sees about products, prices, shops, stock or compatibility is invented.**

## 1. Threat model

| Asset | Why it matters |
|---|---|
| `LLM_API_KEY` | Billing and account abuse. |
| LLM budget | Every call costs money and latency. |
| Availability | The demo must keep working while the LLM is absent, slow, failing or hostile. |
| Honesty of the UI | A wrong price, shop, stock claim or "confirmed" label breaks trust. |
| Users' text | Requirements are typed by users; they are never stored or logged server-side. |

Actors: anonymous internet clients (any request, any rate); scripted abusers (floods, IP rotation); prompt injectors
through their own text **or through data** (shop, mall, category names and item texts that are placed in prompts);
a misbehaving model (arbitrary text, wrong ids, fake tool calls); provider failures (401/403/404/429/5xx, timeouts).

Trust boundaries: browser → server (all input untrusted, validated with zod); server → SQLite (read-only file,
constant SQL, bound parameters); server → LLM (output untrusted, validated like user input); operator environment
(trusted: `LLM_API_KEY`, `TRUST_PROXY`, `ANTHROPIC_*`, `OTEL_*`).

## 2. Controls

### Public endpoint (all `/api/*`)
| Control | Where | Test |
|---|---|---|
| Body limit 16 KB (`BODY_LIMIT_BYTES`), JSON only (415 otherwise), proto/constructor poisoning rejected | `app.ts` | `api.test.ts`, `assist-route.test.ts` |
| Text limits: parse 500 chars, assist 300 chars (Persian 413); state ≤ 12 items, bounded records and strings | `routes/parse.ts`, `routes/assist.ts`, core `api/dto.ts` | `parse-route.test.ts`, `assist-route.test.ts` |
| Timeouts: request/handler 10 s, connection 20 s; LLM per call `LLM_TIMEOUT_MS` (3 s) with hard abort, no SDK retries | `app.ts`, `llm/client.ts` | `llm.test.ts` |
| Rate limit per client: `/api/*` `RATE_LIMIT`/min (health exempt); `/api/assist` its own stricter `ASSIST_RATE_LIMIT`/min | `app.ts`, `routes/assist.ts` | `api.test.ts`, `assist-route.test.ts` |
| Client identity: `TRUST_PROXY` hop function (a forged leftmost `X-Forwarded-For` is ignored); IPv6 keyed by /64, IPv4-mapped as IPv4 | `app.ts`, `llm/gate.ts` | `api.test.ts`, `llm-gate.test.ts` |
| Headers: CSP `default-src 'self'`, `frame-ancestors 'none'`, nosniff, `X-Frame-Options: DENY`, no-referrer, COOP/CORP, Permissions-Policy, HSTS in production, `Cache-Control: no-store` on `/api`; no CORS | `app.ts` | `api.test.ts` |
| Logs: method, path without query, status, timing, request id; never bodies, headers, query strings or error messages | `app.ts` | `api.test.ts`, `assist-route.test.ts` |
| Database: read-only + `query_only`, constant SQL, bound parameters, FTS input quoted token by token | `db.ts`, `retrieval/catalog.ts` | `api.test.ts` |

### LLM layer
| Control | Where |
|---|---|
| Key read once from env, passed explicitly to the SDK, never logged, never in `/api/health` or `/api/meta`, never in a prompt (it is an HTTP header, so the model cannot leak it). Under `NODE_ENV=test` a configured client gets an offline SDK: tests never reach the network. | `config.ts`, `llm/client.ts` |
| SDK logging off (`logLevel: 'off'`, silent logger) and OpenTelemetry off, whatever `ANTHROPIC_LOG` / `OTEL_*` say. Our own log line is `{ op, outcome, ms }` only. | `llm/client.ts`, `app.ts` |
| Circuit breaker: opens after `LLM_BREAKER_THRESHOLD` consecutive failures; half-open lets exactly one probe through; a failed probe doubles the cooldown; 401/402/403/404 trip it at once for 5 min, 429 for its `retry-after`. Every failure is an `LlmError` category, never an uncaught error. | `llm/client.ts` |
| Cost / abuse gate for every LLM call (parse refinement and assistant): `LLM_RATE_LIMIT`/min and `LLM_DAILY_PER_IP`/day per client, `LLM_DAILY_GLOBAL`/day per instance, `LLM_MAX_CONCURRENCY` in flight. Over budget = deterministic answer with `degraded: true`, never an error. Memory bounded (50k clients). | `llm/gate.ts`, `routes/parse.ts`, `assist/service.ts` |
| Prompts: static Persian system prompts that declare every tag's content to be data; all per-request data in the user turn inside `<tag>` blocks; JSON blocks escape `<`, `>` and line separators; free text NFKC-normalised, invisible / bidi / tag characters stripped (ZWNJ kept), `<` `>` replaced, length clipped. | `llm/sanitize.ts`, `llm/refiner.ts`, `assist/interpret.ts` |
| Output: structured output with a static JSON schema; decoded with strict zod (unknown keys rejected); every id checked against facts the server recomputed from the request state (the client never supplies plan ids); categories only from the shortlist. | `llm/refiner.ts`, `assist/interpret.ts` |
| Grounding: parse texts must be the user's own words; quantities and spec values must be written by the user; brands map to `brand_key` only when mentioned; device models, model codes and budgets never come from the model; assistant budget amounts are re-read from the user's words. | `llm/refiner.ts`, `assist/keywords.ts` |
| Assistant: one action from a closed enum, applied by a pure function to the requirement state (never to a plan); templated Persian messages from validated fields; free prose only for `explain` / unsupported and only after a post-check (no numbers outside the call's data, no money words, no URL / e-mail / phone / id-like token / unknown Latin word, no stock or guarantee claims, no system-prompt fragment, no markup). | `assist/*` |
| Concurrency: the LLM result is raced against the budget; on timeout the call is aborted and a late answer is discarded for good (the response is sent once). | `parse/refine.ts`, `assist/service.ts` |
| Deterministic fallback: parse without LLM is complete; the assistant's chips and typed chip phrases never call the LLM; no key = `/api/health` `llm:false` and deterministic everywhere. | `parse/*`, `assist/keywords.ts` |

## 3. Residual risks (accepted, with mitigations)

1. **Injection through data can still pick a valid action** (e.g. a crafted shop name steering the model to exclude
   another shop of the plan). Bounded by the closed action set and id validation; the result is a visible diff with
   «برگرداندن». Product titles are never put in assistant prompts.
2. **Limits are in memory, per process.** A restart resets them; more than one instance multiplies the budgets.
   Many-IP abuse is bounded only by `LLM_DAILY_GLOBAL` (cost) and the per-IP HTTP limits (CPU).
3. **`TRUST_PROXY` must match the real proxy chain** (see §4). Too low: every client shares one bucket (429s for
   everyone, LLM budget spent by anyone). Too high: clients forge `X-Forwarded-For` and dodge per-IP limits (the
   global LLM cap still holds).
4. **The keyword fallback is heuristic.** Unusual phrasing can be misread or not understood; it applies at most one
   action, always undoable, and only clearly targeted ones (ambiguity asks with choices).
5. **The prose post-check is pattern-based.** It cannot prove a Persian sentence true; that is why prose is limited to
   explanations and unsupported requests and is short. It may reject harmless prose (the templated text is shown).
6. **Model id / capabilities.** `LLM_MODEL` must accept structured outputs and `effort` (default `claude-haiku-5-5`).
   A model that rejects them makes calls fail (400 → breaker open → deterministic mode), it never crashes.
7. **Operator environment is trusted.** `ANTHROPIC_BASE_URL` would redirect the key to another host; keep the
   service's environment restricted to the owners.
8. **No authentication by design.** All endpoints are public and stateless; nothing user-specific is stored server-side.
9. Static files and the SPA fallback are not rate limited (cheap; rely on the platform edge for floods).

## 4. After deploy (checklist)

1. **TRUST_PROXY hops** (bundled Caddy or host nginx: `TRUST_PROXY=1`; app published directly on the VPS IP: `TRUST_PROXY=0`; docs/DEPLOY.md has the rationale). From one network send `RATE_LIMIT`+1 requests to `/api/meta`: the last
   one must be 429. From a second network (e.g. a phone hotspot) the next request must still be 200. Repeat the
   first network's last request with a forged `X-Forwarded-For: 1.2.3.4`: it must stay 429. Everyone limited
   together = hops too low; the forged header resets the limit = hops too high.
2. `GET /api/health`: `llm:true` only with a key; the body has no key, model id or path.
3. With the key in the service environment, run once: `npm run llm:smoke -w @app/server` (locally with the same key,
   or a one-off shell). Check that outcomes contain no `model_not_found` / `auth` (model id and key are valid),
   p95 is below `LLM_TIMEOUT_MS`, and the validity rate is high. The script never prints the key.
4. Logs: the `llm call` lines show only `op`, `outcome`, `ms`; no request text anywhere.
5. `curl -I https://<host>/api/health`: CSP, HSTS, nosniff, `Cache-Control: no-store`.
6. A POST over 16 KB returns 413; a 301-character assistant text returns 413.
7. Set `LLM_DAILY_GLOBAL` to the spend you accept and check the provider's usage page after the demo.
8. The web bundle must not contain the key: `grep -r "sk-ant" apps/web/dist` finds nothing.

Kill switch: unset `LLM_API_KEY` (or set `LLM_RATE_LIMIT=0`) and restart: the product runs fully deterministic.

## 5. `claude-cli` backend (TESTING ONLY)

While no API key exists, the LLM layer can be exercised through local headless Claude Code sessions
(`claude -p`, the developer's own login): `LLM_BACKEND=claude-cli`. Code: `llm/claude-cli-client.ts`; selection:
`createLlmClient` in `llm/client.ts`; config: `config.ts`. Production keeps `AnthropicLlmClient` with a real key.

**Opt-in, never required.** Default backend is `anthropic` with `LLM_API_KEY`, else `none`; `claude-cli` needs an
explicit `LLM_BACKEND=claude-cli` and is refused at start-up under `NODE_ENV=production` (config error naming
`LLM_BACKEND`, and again in the factory) unless `LLM_ALLOW_CLI_IN_PROD=1`. No CLI found = `llm:false` and fully
deterministic. The server then listens on `127.0.0.1` unless `HOST` is set explicitly (it spends the developer's
own Claude subscription; with `HOST=0.0.0.0` anyone on the network can, within the `LlmGate` budgets). `/api/health` adds only `llmBackend` (`anthropic` | `claude-cli` | `none`): never a path, model or
version. Same contract as the API client: `LlmError` only, `{ op, outcome, ms }` logs, the same circuit breaker,
`LlmGate` budgets and `degraded` fallbacks; every answer is still validated by the callers' strict zod schemas.

| Control (every call) | Detail |
|---|---|
| No shell, no prompt in argv | `spawn(absolutePath, argv)`; the binary is resolved once (explicit `LLM_CLI_BIN` must be absolute; PATH lookup only over absolute entries, never under `NODE_ENV=test`). The prompt goes to stdin; the static system prompt to a 0600 file; argv = static flags + model + that path + the static JSON schema. |
| No tools, no extensions | `--tools ""`, `--strict-mcp-config`, `--setting-sources ""`, `--safe-mode`, `--restricted`, `--disable-slash-commands`, `--permission-mode=dontAsk`, `--permission-prompts=none`, `--no-session-persistence`, `--max-turns=4`, `--max-budget-usd=0.5`, `--effort=low`; env `ENABLE_CLAUDEAI_MCP_SERVERS=false`, `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, telemetry / auto-update off. |
| Verified at run time | `--output-format=stream-json --include-hook-events`: the init event must list no tool but `StructuredOutput` (only with a schema) and no MCP server, permission mode `dontAsk`; every `tool_use` must be `StructuredOutput`; any hook event, other tool or a missing init kills the process group (`isolation`, circuit open 10 min). |
| No file reads through the prompt | Probe: `@/abs/path` in the prompt text made the CLI attach that file even with no tools. Disabled twice: `CLAUDE_CODE_DISABLE_FILE_MENTIONS=1` / `CLAUDE_CODE_DISABLE_ATTACHMENTS=1`, and every `@` in stdin becomes U+FF20 (each verified alone with a canary file). A prompt that does not start with a tag is wrapped in `<input>` (no `/`, `!`, `#` command prefix). |
| No repository access | cwd = an empty dir inside a private 0700 `mkdtemp` dir under the OS temp dir (`TMPDIR` is a sibling dir), removed after the call. Probe: a `CLAUDE.md` / `AGENTS.md` planted in the cwd's parent steered the model without the hardening and was ignored with it. |
| Minimal environment | Only `HOME` (the CLI's login), `CLAUDE_CONFIG_DIR` and `HTTP(S)_PROXY` / `ALL_PROXY` / `NO_PROXY` when set, fixed `PATH=/usr/local/bin:/usr/bin:/bin`, `LANG`, per-call `TMPDIR`, the token cap and the switches above. Never `LLM_API_KEY`, `ANTHROPIC_*`, `NODE_OPTIONS`, a parent Claude Code session's tokens, or anything else. |
| Bounded | Hard timeout = the call's budget (SIGTERM, then SIGKILL to the whole process group); 256 KiB stdout cap (stderr discarded); 20 000-char answer cap; 1-2 calls in flight (`LLM_CLI_CONCURRENCY`, beyond = `busy`, deterministic) and at most twice as many live processes (an answered one gets 2 s to exit); 64 KiB prompt cap. Live CLI process groups are killed and their temp dirs removed when the server process exits (not after a SIGKILL of the server). |
| Output | One JSON object from the CLI's structured output (or its result text if it parses as one object); any key or string with a tool-call format (`<function_calls>`, `<invoke`, `"type":"tool_use"`, `tool_use_id`, ...) is rejected, never repaired; then the usual zod / grounding / id checks. |
| Privacy | stdin, stdout, stderr, the CLI path and its version are never logged; errors carry the category only. |

Residual risks of this backend (accepted for local testing only):
1. **It drives a full agent runtime with the developer's account.** Isolation rests on CLI flags and env switches
   verified against Claude Code 2.1.306; a future version could change them. Unknown flags make every call fail
   (circuit open, deterministic), and the run-time init / tool / hook checks catch a widened tool set, but not every
   conceivable change (e.g. a new pre-processing of prompt text). Re-run the smoke test after CLI updates.
2. **The CLI reads its credentials from `HOME` and writes its own state there** (`~/.claude`: token refresh, caches).
   Usage counts against the developer's subscription limits; `--max-budget-usd` and the gate bound each call.
3. **Same-user processes are not a boundary.** Anything running as the server's user can read the temp dir or
   ptrace the CLI; this backend is for a developer machine, not a shared or public host.
4. **Latency.** A call costs a process start plus a Claude Code turn (seconds). Defaults: `LLM_TIMEOUT_MS=20000`,
   `REQUEST_TIMEOUT_MS=LLM_TIMEOUT_MS+5000`. Slow answers are dropped (deterministic, `degraded: true`).
5. **'@' is shown to the model as '＠'.** An id containing '@' cannot be echoed exactly (the answer is then rejected
   and the result is deterministic).

### Container hardening not applied

`security_opt: no-new-privileges` and `init: true` are deliberately not used in `compose.yaml`: the dev machine runs snap-packaged Docker, whose AppArmor profile makes exec fail with `no-new-privileges`, and node is PID 1 without child processes. Add both on a regular (non-snap) Docker host if wanted.

## Response compression (BREACH, request bodies)

The Fastify app compresses responses itself (the container is also reachable directly on its port, bypassing any proxy `encode`):
text assets are served from `.br` / `.gz` siblings written at image build (`apps/server/scripts/precompress.mjs`, `@fastify/static` `preCompressed`; `Vary: Accept-Encoding`, `Cache-Control: immutable` for hashed `/assets`), and JSON / HTML without a sibling is compressed on the fly by `@fastify/compress` (brotli quality 4 or gzip, bodies of 1 KiB and above only; woff2 and other already-compressed types are skipped).

- **BREACH.** The attack needs a secret in the response body and attacker-controlled text reflected next to it, observable over many requests. API responses carry no session token, CSRF token, cookie, API key or any other secret (there are no accounts or cookies; the LLM key never leaves the server and is not part of any body), and error envelopes never echo request text. Compression is therefore not an oracle for anything confidential. Keep it that way: never put a secret in a JSON/HTML body, and revisit this note if sessions or CSRF tokens are ever added.
- **Request bodies are never decompressed** (`globalDecompression: false`): a request with `Content-Encoding` is rejected like any unsupported body, so a compression bomb cannot slip past the 16 KB body limit.
- Range requests are off for static files (a partial compressed body is meaningless); small bodies and error envelopes are sent uncompressed and unchanged.
