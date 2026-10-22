# Architecture

One TypeScript monorepo, one container, one read-only SQLite file. **The deterministic engine decides; the LLM only
interprets words, and is optional.** Background and rejected alternatives: [PLAN.md](PLAN.md) part B.

## 1. Components

| Path | Role |
|---|---|
| `packages/core` | Pure, framework-free logic shared by the data build and the server: Persian normalisation, attribute extractors (`extract/`), requirement model and item-state classifier (`requirement/`), compatibility rules (`compat/`), question engine (`questions/`), exact planner (`plan/`), API types with zod schemas (`api/`), Persian copy (`copy/`). |
| `scripts/data` | Offline build: CSV to `market.sqlite` (cleaners for price, hours and address; extractors; FTS5 index; synonyms), quality gates and `quality-report.json`, labelled samples for extraction accuracy. |
| `apps/server` | Fastify 5 API plus static web app. `parse/` (text to items), `retrieval/` (FTS and candidate pools), `adapter/` (maps DB rows to the engine's types, calls core), `assist/` (closed-action assistant), `llm/` (client, gate, circuit breaker, sanitiser, optional claude-cli backend), `routes/`, `app.ts` (limits, headers, errors), `warm.ts` (pre-warm). Bundled by esbuild into one `server.mjs`. |
| `apps/web` | React 18 + Vite + Tailwind (logical properties only), Vazirmatn font, Zustand store with local persistence, react-router (hash routes), lz-string for share links, a small app-shell service worker. |
| `deploy/`, `docker/`, `Dockerfile`, `compose.yaml` | Single-container deployment, optional Caddy, scripts for data push, deploy, smoke and rollback ([DEPLOY.md](DEPLOY.md)). |

The server holds **no session and no user data**. The client sends the whole requirement state with every call, so any
call is a pure function of (state, database).

## 2. Data flow: parse, resolve, plan, assist

```
 user text ──► POST /api/parse ──► items (qty, category, constraints, budget, model code, preference)
                  │  deterministic parser always runs;
                  │  optional LLM refinement raced against a 3 s budget (late answer discarded)
                  ▼
 requirement state (client) ──► POST /api/resolve ──► per item: state, eligible count, price range,
                  │                                    suggested product + rule, next question, noMatch
                  │   FTS candidates ► constraints pass/fail/unknown ► classify ► compat derived constraints
                  ▼
 requirement state ──► POST /api/plan ──► stops (buildings) with offers, totals with coverage,
                  │                        compat findings, Pareto alternatives, reason sentences
                  │   cheapest valid offer per (building, item) ► subset DP ► Pareto(cost, stops) ► plan guard
                  ▼
 chip or free text ──► POST /api/assist ──► ONE closed action ► applied to the requirement state
                                            ► plan recomputed ► diff + «برگرداندن»
 POST /api/options (similar models / sellers of an item) · GET /api/meta · GET /api/health
```

**Parse.** Normalise (ی/ک, digits, ZWNJ), split into items on «،», «و» and newlines, read quantities, model codes, brand
and spec tokens with the same extractors the data build used, vote the category over FTS hits, and let items inherit
context (a case or glass takes the phone model from the phone item, shown as an editable chip). The LLM refinement is
constrained to a shortlist of category names and a closed constraint schema; its output is decoded by strict zod and
grounded (texts must be the user's own words; device models, model codes and budgets never come from the model).

**Resolve.** For each item the candidates are filtered per constraint into pass / fail / unknown. A model code match is
exact; all stated constraints passing makes a product eligible; unknown on an attribute the user (or a compatibility
rule) needs makes it incomplete (listed, never auto-picked); a fail is an alternative only when relaxed. Used,
refurbished and replica listings and plausibility failures (title head of another kind, wire unit doubt) are set aside
the same way. The question engine then asks, in this order: compatibility-critical unknowns (for example analog or IP
cameras for the recorder, the adapter voltage, the wire sale unit), the most discriminating attribute, and a budget band
from the real price distribution. Every question is templated Persian and skippable («فرقی نمی‌کند», «کافیه، پیشنهاد بده»),
except the ones whose wrong guess breaks the purchase (the wire sale unit has no skip).

**Plan.** See section 3. **Assist.** See section 7.

## 3. The planner (exact, tiny problem)

- Stops are **buildings** (`building_key`: the mall key, else coordinates rounded to about 11 m). For every (building,
  item) the price is the cheapest valid offer times the quantity. Valid: usable price, not an excluded shop or mall, not
  closed at the chosen day and time (shops without hours are never closed). One item is bought at one stop; quantities are
  not split because stock is unknown.
- `f[j][k][mask]` = minimum cost to buy exactly the item set `mask` using exactly `k` of the first `j` buildings, each used
  building buying a non-empty subset. Cost is O(N x K x 3^m); at most **8** priced items are planned at once (the state
  allows 12 items).
- **Coverage first**: the largest coverable item set wins; then the exact **Pareto set over (total cost, number of
  stops)** at that coverage. Anything dominated is hidden; each non-dominated alternative is shown with its real deltas
  («۱٫۸ میلیون تومان بیشتر، ۲ توقف کمتر»). With a single option nothing is offered and the reason is given. No tolerance
  constants (no 5 % rule).
- Default selection: the user's stated or tapped preference (cheaper, fewer stops); otherwise the cheapest plan at maximal
  coverage. Ties at equal (cost, stops) go to the more compact set (smaller maximum pairwise haversine distance).
- Stop order: nearest neighbour from the densest stop, worded «ترتیب پیشنهادی»; distances are straight lines.
- **Plan guard** (`apps/server/src/adapter/engine.ts`): after planning, any compatibility *conflict* that involves an
  automatic pick is repaired by adding the rule's constraints and re-resolving (at most 3 rounds); if it cannot be
  removed, the automatic pick is taken out and the item becomes «نیاز به اطلاعات». A plan with such a conflict is never
  offered, so a conflict never coexists with a "complete" total.
- Properties covered by tests: never worse coverage, deterministic, bounded alternatives, 120 seeded random CCTV and phone
  states never show a conflict the engine caused.

## 4. Item states and compatibility levels

| Item state (code) | Persian label | Counted in total |
|---|---|---|
| `exact_model` | «مدل مشخص» (user typed a model code or picked a model) | yes |
| `suggested` | «پیشنهاد» + eligible count + pick rule | yes, flagged «با مدل‌های پیشنهادی» |
| `alternative` | «جایگزین» + what differs | yes, flagged |
| `needs_info` | «نیاز به اطلاعات» | no |
| `not_found` | «پیدا نشد» | no |
| `price_unknown` | «قیمت ثبت نشده» | no |

A suggestion is never worded as exact. Compatibility statuses (`listing_stated`, `assumed`, `unknown`, `conflict`) map
to «طبق عنوان آگهی», «فرض عمومی؛ تأیید نشده», «نامشخص» and «ناسازگار». Rules exist only for CCTV (recorder kind for the
camera signal type, recorder channels at least the camera quantity, an internal SATA drive, a surveillance drive, a 12 V
adapter) and phone accessories (device model in the title); they emit *derived constraints* from the items' stated
requirements, and after the planner picks products the same rules are re-evaluated on them to set the chips. Everything
that is assumed or unknown is copied to the show-to-seller card as «از فروشنده بپرس».

## 5. Persistence and sharing (local only)

- `localStorage` key `plans:v1` (zustand `persist`, payload version 2, migrated). It stores requirements, answers, pins,
  preferences, day and time, mode, checklist marks and user reports, **not computed plans**: plans are recomputed on
  open, so they always match the dataset version. Up to 30 plans are kept; autosave shows «✓ ذخیره شد روی همین گوشی».
- If storage is unreadable (private browsing) a quiet notice says so and the app still works.
- **Share link**: the requirement state (not checks, not reports, not parser diagnostics) is compressed with lz-string
  into the URL hash (`#/s/...`). Opening it imports an editable **copy**. No server, no account.
- User reports stay in the device's plan and are never part of dataset totals; undo is always available after an
  automatic replan.

## 6. Failure modes

| Failure | Behaviour |
|---|---|
| LLM absent, slow, failing, over budget, hostile | The deterministic parse and the assistant's chips and typed chip phrases answer; responses carry `degraded: true` and the UI shows a calm line. A circuit breaker opens after repeated failures. The product is complete without the LLM. |
| Database missing or unreadable | The server still starts; `/api/health` returns `status: "degraded", db: false` (HTTP 200 so a deploy goes live); data endpoints answer 503 with the Persian envelope «داده‌های بازار هنوز در دسترس نیست.». |
| Server unreachable from the browser | The app shell is cached by a service worker (`/api` is never cached): a reload still opens the app, the resume card and the saved plan's items; «اتصال به سرور برقرار نیست» with «دوباره امتحان کن»; prices are recomputed once the server answers. |
| Slow server | «سرور کمی دیر جواب می‌دهد» notice; a refresh failure keeps the last result with a notice. |
| Dataset version changed | Plans are recomputed on open with the notice «داده‌ها به‌روز شده‌اند؛ قیمت‌ها دوباره محاسبه شد.». |
| Bad input | Zod validation on every route; every error leaves as a fixed Persian envelope `{ error: { code, messageFa } }`, never a stack trace, path or request text. |
| Rate limit exceeded | 429 in the same envelope. |
| Restart | State lives in the client; the server has nothing to lose. Limits reset (in-memory), see SECURITY residual risks. |

Cold start: the server listens in under a second and pre-warms the title-head counts and the candidate pools of the demo
categories in the background (about 0.6 s for 12 categories); later calls take about 10 to 20 ms per resolve or plan.

## 7. The LLM layer (small, grounded, optional)

Three jobs, everything else is templated Persian:

1. **Parse refinement**: category only from the server's shortlist, constraints only from a closed schema.
2. **Assistant**: free text to one action from a closed enum (`set_preference`, `exclude_shop`, `exclude_mall`,
   `only_open`, `swap_brand`, `relax_constraint`, `set_budget`, `add_item`, `remove_item`, `explain`). Ids are checked
   against facts the server recomputed from the request state; the action is applied by a pure function to the
   *requirement state* (never to a plan), and the plan is recomputed with a diff and «برگرداندن». No transcript is kept.
3. **Explain / unsupported**: short Persian prose, accepted only after a post-check (no numbers outside the call's data,
   no money words, no URL, phone, e-mail, stock or guarantee claims).

Backends: `AnthropicLlmClient` (`LLM_API_KEY`, default model `claude-haiku-5-5`, 3 s budget) in production; `none`
without a key; `claude-cli` for local testing only (refused in production).

## 8. Security controls (summary of [SECURITY.md](SECURITY.md))

- Public endpoint: 16 KB JSON-only bodies, text limits (parse 500 chars, assist 300), state bounded to 12 items, request
  timeouts, per-IP rate limits (`RATE_LIMIT`, stricter `ASSIST_RATE_LIMIT`), proxy-aware client identity (`TRUST_PROXY`),
  CSP `default-src 'self'`, `frame-ancestors 'none'`, nosniff, no-referrer, HSTS in production, `no-store` on `/api`, no
  CORS, logs without bodies or query strings.
- Database: opened read-only with `query_only`, constant SQL, bound parameters, FTS input quoted token by token.
- LLM: key read once from the environment and never logged, exposed or put in a prompt; SDK logging and telemetry off;
  circuit breaker; a cost gate (per-minute, per-IP daily, global daily, concurrency) that degrades to the deterministic
  answer; static Persian system prompts that declare every tag's content as data; user text and data names sanitised;
  structured output with strict zod; every id validated; assistant prose post-checked.
- Container: non-root, read-only root filesystem, tmpfs `/tmp`, capabilities dropped, memory / CPU / PID limits, log
  rotation, app published on loopback behind Caddy or nginx.
- Residual risks (accepted and documented): injection through data can still pick a *valid* action (bounded by the
  closed set and visible with undo); limits are per process; `TRUST_PROXY` must match the proxy chain; the keyword fallback is
  heuristic; no authentication by design.

## 9. Testing

| Layer | What |
|---|---|
| Unit (vitest) | normalisers, extractors, cleaners (price, hours, address), compat rules, planner properties, question engine, Persian formatters, RTL rules, store and share link. |
| API / scenario | fixture market and real-data suites (`DATABASE_PATH=... npm test`): the contract scenarios, compat guard (including a seeded property test), suggestion-quality regressions from the audit, error mapping, hours, not-found behaviour, LLM client, refiner, gate, breaker, assistant routes with a fake LLM, the claude-cli client with a fake CLI. |
| E2E (Playwright) | `npm run e2e -w @app/web`: UI smoke on a mock engine. `npm run e2e:real -w @app/web`: 26 specs at 390x844 and 360x640 against the built server and real database (journeys, dead ends, bidi isolation, offline shell, share link, overflow and touch-target checks, no phone numbers). |
| Totals | 1,003 tests with the real database; 831 passed and 40 skipped without it. |
| Audit | `npm run audit:suggestions -w @app/server` runs 61 requests (73 audited items) through the in-process app; every pick was read by hand ([AUDIT-suggestions.md](AUDIT-suggestions.md)). |
| Data gates | `npm run data:check`: join integrity, no contacts or phone numbers, price range, no sentinel hours, FTS timings (p95 about 1 ms), attribute coverage. |
