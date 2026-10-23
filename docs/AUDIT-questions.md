# Question audit: which questions the assistant asks, and are they worth it

Snapshot: `market.sqlite` 2026-10-13 (225,903 listings). Reproduce:

```
DATABASE_PATH=/abs/path/market.sqlite npm run audit:questions -w @app/server -- --json out.json
```

`apps/server/scripts/audit-questions.ts` sends 29 shopping sentences (35 items) covering the bazaar's main domains
through the in-process app exactly as the web app does: `/api/parse` → state (parser items verbatim) →
`/api/resolve`. Whenever an item shows a question, **every option is tried once** (one more `/api/resolve` each) and
its effect is measured on the item's eligible models, independently of the engine's own scoring:

- **elim %**: share of the eligible models the answer removes (1 − eligible after / eligible before);
- **spread %**: how much the answer narrows the eligible price range, 1 − ln(high/low after) / ln(high/low before);
- both are averaged over the options, weighted by the models each keeps (a big option is a likelier answer).

The walk then answers the option that keeps the most models (the longest path, i.e. the most questions an item can
get) and resolves again until nothing is asked. `[engine]` is the engine's own score of the same question (core
`informationValue`, below), which does not count models removed only because their attribute is unreadable.

## Before → after

| | before | after |
|---|---|---|
| questions over the 35 items (longest path) | **60** | **51** |
| most questions on one item | 4 («دوربین مداربسته») | 2 |
| items asked more than 2 questions | 6 | 0 |
| options keeping 1-3 models out of hundreds (e.g. «آنالوگ ۳» of 260 cameras) | shown | never shown |
| facet questions with a «چرا می‌پرسم» line | 0 (only compat and budget) | all |
| option hint | «۱۴۰ مدل» | «۱۴۰ مدل · از ۱٫۲ میلیون» |

The CCTV example («۴ دوربین داهوا ۲ مگاپیکسل، ضبط‌کننده ۴ کانال و هارد ۲ ترابایت و آداپتور»): camera 2 → 2,
recorder 3 → 2, drive 2 → 2, adapter 3 → 2. The phone example («گوشی سامسونگ A56 با قاب و گلس»): phone 0 → 0,
case 2 → 1, glass 0 → 0; «گوشی موبایل» 3 → 2; «قاب گوشی» 2 → 2.

### Every item (longest path; elim/spread = measured %, [engine] = the engine's narrowing/spread %)

| # | request › item | before: questions (elim/spread %) | n | after: questions (elim/spread % [engine]) | n | stop |
|---|---|---|---|---|---|---|
| 1 | ۴ دوربین داهوا ۲ مگاپیکسل، ضبط‌کننده ۴ کانال و هارد ۲ ترابایت و آداپتور › دوربین داهوا ۲ مگاپیکسل | camera_signal 56/37 → budget 64/67 | 2 | camera_signal 55/37 [44/32] → budget 64/67 [64/65] | 2 | question_cap |
| 2 | ۴ دوربین داهوا ۲ مگاپیکسل، ضبط‌کننده ۴ کانال و هارد ۲ ترابایت و آداپتور › ضبط‌کننده ۴ کانال | recorder_kind 32/36 → brand 84/35 → budget 64/70 | 3 | recorder_kind 32/36 → budget 64/68 [64/66] | 2 | question_cap |
| 3 | ۴ دوربین داهوا ۲ مگاپیکسل، ضبط‌کننده ۴ کانال و هارد ۲ ترابایت و آداپتور › هارد ۲ ترابایت | brand 40/14 → budget 65/71 | 2 | budget 66/71 [66/71] → brand 34/11 [24/10] | 2 | question_cap |
| 4 | ۴ دوربین داهوا ۲ مگاپیکسل، ضبط‌کننده ۴ کانال و هارد ۲ ترابایت و آداپتور › آداپتور | voltage_v 39/27 → current_a 79/55 → budget 47/47 | 3 | voltage_v 39/27 → budget 64/65 [64/64] | 2 | question_cap |
| 5 | دوربین مداربسته | brand 85/22 → resolution_mp 75/34 → camera_signal 56/37 → budget 64/67 | 4 | camera_signal 74/25 [31/14] → budget 63/65 [63/62] | 2 | question_cap |
| 6 | ۸ دوربین تحت شبکه و ان وی آر › دوربین تحت شبکه | brand 79/26 → resolution_mp 72/45 → budget 61/65 | 3 | budget 63/65 [63/62] → resolution_mp 80/33 [58/26] | 2 | question_cap |
| 7 | ۸ دوربین تحت شبکه و ان وی آر › ان وی آر | brand 73/19 → budget 53/66 | 2 | budget 61/67 [61/61] → brand 62/9 [52/8] | 2 | question_cap |
| 8 | دی وی آر ۸ کانال | budget 63/71 | 1 | budget 63/71 [63/68] | 1 | no_discriminating_question |
| 9 | هارد ۱ ترابایت | brand 44/17 → budget 65/69 | 2 | budget 65/64 [65/64] → brand 30/21 [23/19] | 2 | question_cap |
| 10 | آداپتور ۱۲ ولت | current_a 79/55 → budget 47/47 | 2 | budget 64/65 [64/64] → current_a 73/26 [63/23] | 2 | question_cap |
| 11 | گوشی سامسونگ A56 با قاب و گلس › گوشی سامسونگ A56 | — | 0 | — | 0 | fits_one_screen |
| 12 | گوشی سامسونگ A56 با قاب و گلس › قاب | brand 30/39 → budget 60/63 | 2 | budget 66/68 [66/68] | 1 | no_discriminating_question |
| 13 | گوشی سامسونگ A56 با قاب و گلس › گلس | — | 0 | — | 0 | fits_one_screen |
| 14 | گوشی موبایل | phone_model 98/85 → storage_gb 61/51 → budget 43/76 | 3 | budget 66/67 [66/66] → brand 74/28 [63/26] | 2 | question_cap |
| 15 | قاب گوشی | fits_models 95/32 → budget 61/68 | 2 | fits_models 95/32 → budget 61/68 [60/62] | 2 | question_cap |
| 16 | گلس آیفون ۱۳ | budget 64/72 | 1 | budget 64/72 [64/69] | 1 | fits_one_screen |
| 17 | لپ تاپ | brand 78/49 → budget 65/64 | 2 | brand 78/49 [75/48] → budget 65/64 [65/64] | 2 | question_cap |
| 18 | لپ تاپ ایسوس | budget 65/64 | 1 | budget 65/64 [65/64] | 1 | no_discriminating_question |
| 19 | سیم برق ۲.۵ افشان ۵۰ متر | sale_unit 34/— → wire_cores 68/54 → budget 65/68 | 3 | sale_unit 34/— → wire_cores 68/54 [66/53] | 2 | question_cap |
| 20 | کابل شبکه | brand 71/15 → budget 65/67 | 2 | budget 65/67 [65/65] → brand 75/4 [31/2] | 2 | question_cap |
| 21 | کلید و پریز | brand 85/62 → budget 62/71 | 2 | budget 65/67 [65/66] → brand 63/7 [49/6] | 2 | question_cap |
| 22 | فیوز مینیاتوری | budget 60/67 | 1 | budget 60/67 [60/60] | 1 | no_discriminating_question |
| 23 | قفل درب | budget 59/67 | 1 | budget 59/67 [59/60] | 1 | no_discriminating_question |
| 24 | دزدگیر اماکن | brand 85/54 → budget 46/48 | 2 | budget 63/67 [63/65] → brand 84/69 [64/55] | 2 | question_cap |
| 25 | مودم روتر | brand 83/42 → budget 51/74 | 2 | budget 65/69 [65/68] → brand 68/22 [23/12] | 2 | fits_one_screen |
| 26 | سوییچ شبکه ۸ پورت | brand 85/46 → budget 63/63 | 2 | budget 65/67 [65/65] | 1 | no_discriminating_question |
| 27 | پچ کورد | — | 0 | — | 0 | no_candidates |
| 28 | پرینتر لیزری | brand 37/9 → budget 65/67 | 2 | budget 63/67 [63/64] → brand 43/9 [43/9] | 2 | question_cap |
| 29 | کارتریج اچ پی | budget 65/64 | 1 | budget 65/64 [65/64] | 1 | no_discriminating_question |
| 30 | یو پی اس | — | 0 | — | 0 | no_candidates |
| 31 | باتری ۱۲ ولت ۷ آمپر | brand 88/49 → budget 65/65 | 2 | budget 64/65 [64/63] → brand 79/33 [57/26] | 2 | question_cap |
| 32 | دریل شارژی | brand 92/64 → budget 66/66 | 2 | budget 61/65 [61/59] → brand 91/62 [42/32] | 2 | question_cap |
| 33 | پیچ گوشتی | budget 58/67 | 1 | budget 58/67 [58/58] | 1 | no_discriminating_question |
| 34 | لامپ ال ای دی ۱۰ وات | budget 57/74 | 1 | budget 57/74 [56/65] | 1 | no_discriminating_question |
| 35 | پروژکتور | budget 64/67 | 1 | budget 64/67 [64/64] | 1 | no_discriminating_question |

Why questioning stopped after the fix: cap reached 19, nothing meaningful left to ask 10 (no attribute with two meaningful options covering half of the remaining models: e.g. the A56 case and the 8-port switch lose the brand question they had before, once the budget is answered), list fits one screen 4, not found 2. No question in this sample fell under the 15 %/20 % value floor: what used to be asked was all above it; the extra questions came from the missing cap, tiny options and options covering a sliver of the pool.

## Findings (before)

1. **Too many questions on wide items.** Six items got 3-4 questions: «دوربین مداربسته» was asked brand,
   resolution, analog/IP and budget; the recorder and the adapter of the CCTV example got a compat question plus two
   more. Each extra question narrowed a pool the previous ones had already narrowed (the recorder's third, budget,
   was asked over 32 models).
2. **The decisive question came late.** For a lone camera the analog-vs-IP question (it decides which recorder the
   user needs) came third, after brand and resolution, because the old score (entropy × coverage) prefers
   attributes with many values: brand had 6+ values and won by default.
3. **Tiny options.** Options keeping 1-3 models out of hundreds were offered: «آنالوگ ۳» (of 260 cameras),
   «۱ مگاپیکسل ۱», «توشیبا ۱», «ای دیتا ۱», «تندا ۱». Picking one leaves a near-empty list; they are noise.
4. **Options that covered a sliver of the pool.** «گوشی موبایل» was asked «کدام مدل گوشی؟» with six iPhone models
   (23, 14, 10, 7, 6, 6 listings) out of hundreds of phones: 98 % elimination, but the six options covered about a
   tenth of the eligible phones, so any other phone needed «فرقی نمی‌کند».
5. **No reason, no consequence.** Facet questions had no «چرا می‌پرسم»; options showed only a count, not where the
   answer leads in price.
6. **The recorder compat question could offer an option that keeps nothing** (count 0) when the pool held only one
   family; it never happened in this snapshot but nothing prevented it.

Measured value of what was asked (before): budget always narrowed the pool by 57-66 % and the price spread by
63-76 %; brand by 30-92 % but often only through listings whose brand is unreadable (laptops 78 %, network cable
71 %/15 %, drives 40 %/14 %); analog/IP 55 %/37 % for the CCTV camera. Nothing measured under ~15 %/20 % was asked in
this sample, but drives' second brand question (WD 16 / Seagate 3) was close.

## The policy now (core `questions/next.ts`)

- **Cap**: at most 2 questions per item (`MAX_QUESTIONS_PER_ITEM`); every question already shown counts (answer,
  «فرقی نمی‌کند», budget band; the adapter passes them as `answeredQuestions`). A **compatibility-critical** question
  (analog vs IP for the recorder next to cameras, the phone model for a case or glass, the wire's sale unit, the
  adapter voltage next to cameras) is never dropped: it may be a third one only if it appears after two others.
- **Value**: for each candidate question, from the eligible models, weighting options by size,
  pool narrowing = (1 − Σ share²) × coverage and spread narrowing = (1 − Σ share × ln(max/min)ₒₚₜᵢₒₙ / ln(max/min)ₐₗₗ) × coverage.
  Coverage (the share of eligible models the offered options cover) discounts both: hiding unreadable listings is not
  information. A question under **15 % pool and 20 % spread narrowing** is not asked.
- **Order**: the role's key question first (`KEY_FACETS`: camera analog/IP, recorder type, adapter voltage, wire
  section; still non-blocking, and kept even when half the listings do not state it: next to a stated DVR only 704
  of the 2,210 compatible cameras say their signal), then by value, biggest first; the budget question competes on
  the same value.
- **Options**: only meaningful ones (≥ 2 models and ≥ 2 % of the pool; at most 6); fewer than two is no question; an
  option that keeps nothing is never offered (compat ones included); models ruled out by a sibling (IP cameras next to
  a stated DVR) do not count against coverage.
- **Copy** (`copy/fa.ts`): one-line `questionWhy` per attribute (the budget line quotes the real range: «قیمت این
  مدل‌ها ۱٫۲ تا ۱۳٫۲ میلیون تومان است؛ …»), and `questionOptionHint`: «۱۴۰ مدل · از ۱٫۲ میلیون» from the cheapest
  eligible model the option keeps. API shapes are unchanged (additive: `QuestionOption.minPrice`, `Question.why`,
  `Requirement.answeredQuestions`, stop reasons `question_cap` / `low_value`).

Tests: `packages/core/src/questions/__tests__/questions.test.ts` (cap, ordering, suppression, key facets,
`informationValue`), `apps/server/test/questions-policy.test.ts` (fixture market: walk ≤ 2, why and hints, compat never
capped, answer counting), `apps/server/test/questions-policy-real.test.ts` (gated: CCTV and phone examples ≤ 2 per
item under three answer strategies).

## Not fixed here (outside the question engine)

- **Most domains have only brand and budget to ask.** Facets exist only where an extractor does (CCTV, phones and
  accessories, wire). Laptops get «برند؟» and «بودجه؟» but never RAM/storage/CPU; sockets, breakers, locks,
  alarms, routers, switches, printers, cartridges, drills, lamps and projectors likewise. Adding extractors (laptop
  RAM/storage, breaker amperage, switch port count, projector watts) would give these items better questions.
- **Parse/retrieval misses seen in the sample**: «پچ کورد» and «یو پی اس» resolve to nothing (not found); «باتری ۱۲
  ولت ۷ آمپر» (a UPS/alarm battery) retrieves phone batteries (brands Apple, Xiaomi, Samsung).
- **Budget is usually one of the two questions.** Its value is consistently high (≈ 60-66 % / 60-70 %), so by the
  value rule it is asked first unless a facet splits better (laptop brand, the camera's key question). If the owner
  prefers spec questions before price, that is a one-line ranking change (`budgetQuestion` value), not a new rule.
- **Compat option counts** are taken over eligible + incomplete models (as before), while the price «از …» uses
  eligible models only, so «۲ مدل» may include a listing whose other specs are unreadable.
