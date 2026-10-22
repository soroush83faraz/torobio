# Suggestion-quality audit (F3) — the first suggestion on real data

Snapshot: `market.sqlite` 2026-10-13 (225,903 listings). Reproduce:

```
DATABASE_PATH=/path/to/market.sqlite npx tsx apps/server/scripts/audit-suggestions.ts [--json out.json]
```

The script runs 61 Persian requests (CCTV, wire, switches/sockets, lighting, phones and accessories, watches,
laptops, TVs, shoes; 73 audited items with the multi-item requests and both wire sale units) through the in-process
app: `/api/parse` → state (parser items verbatim) → `/api/resolve`, settling every skippable question
(«کافیه، پیشنهاد بده»; that is the default pick), answering a wire's mandatory sale-unit question once with «حلقه»
and once with «متری», then `/api/plan`. Per item it prints the pick, its price and category, eligible / incomplete /
candidate counts, the pick's price rank in the eligible set, the eligible median and review flags (`cheap10`: pick
< 1/10 of the eligible median; `nohead`: the pick's title has none of the request's words). The flags are reading
aids for the reviewer; the engine never reads them. Every pick was read by hand.

## Findings (before) and the worst 10, before → after

Before the fix, **24 of 73 first suggestions were the wrong kind of thing, a unit confusion or a mismatch with a
stated spec**. The rule "cheapest eligible" is honest, but the cheapest listing in a category is very often not the
product: accessories and parts are filed in the product's category, roll listings carry a per-metre price, and
several specs the user typed (watts, mAh, inches, «مفتولی») were read by the parser and then silently dropped.

| # | request | before (pick, toman) | what was wrong | after (pick, toman) |
|---|---|---|---|---|
| 1 | ساعت هوشمند / اپل واچ | کاور ایرپاد پرو ضدضربه (389,000) | an AirPods cover filed under smart watches | ساعت هوشمند T10000 Ultra3 با بند سیلیکونی (1,108,800) |
| 2 | آداپتور (also in the CCTV job) | فیش آداپتور نری سر زرد دیسمکن 1.7 میلی متری (30,000) | a DC plug, not an adapter | آداپتور ۲ آمپر وارداتی (62,000) |
| 3 | سیم ۲.۵ by the roll | سیم افشان سیمیا ۲.۵ … طول ۱۰۰ متر (45,000) | «100 m» listing at a one-metre price (typical roll ≈ 5.5 M) | سیم برق افشان 1 در 2/5 حلقه 100 متری … (1,465,000) |
| 4 | سیم ۶ / ۱.۵ / ۳×۲.۵ by the roll | 28,000 / 29,000 / 103,800 | same unit confusion | 3,945,000 / 1,000,000 / 8,450,000 |
| 5 | پریز برق | کلید بین راهی (18,000) | a switch for a socket request | پریز برق لگرند ارت دار (33,000) |
| 6 | شارژر ۲۵ وات | آداپتور 4.2V … چراغ قوه (148,000) | a torch charger; «۲۵ وات» was dropped | شارژر سامسونگ EP-TA800 توان 25 وات (350,000) |
| 7 | پاوربانک / پاوربانک ۲۰۰۰۰ | باتری لیتیوم پلیمر پاور بانک 10000 (750,000) | a battery cell; «۲۰۰۰۰» was dropped | پاوربانک وایرلس … / پاوربانک کینگ پاور 20000 میلی آمپر (1,576,500) |
| 8 | تلویزیون سامسونگ ۵۵ اینچ | تلویزیون سامسونگ T5300 سایز ۴۳ اینچ (65.9 M) | 43" for a 55" request («۵۵ اینچ» dropped) | سامسونگ U8000F سایز ۵۵ اینچ (99.5 M) |
| 9 | پروژکتور ال ای دی ۱۰۰ وات | پرژکتور ۵۰ وات بیلبوردی (300,000) | 50 W for 100 W («۱۰۰ وات» dropped) | پروژکتور ال ای دی ای لایت ۱۰۰ وات (400,000) |
| 10 | هدفون / ایرپاد | هندزفری سامسونگ HS3303WE (115,000) | wired in-ear handsfree for headphones / AirPods | هدفون بی سیم سی بای C2N (137,000) / ایرپاد بی سیم سامسونگ K30 (185,000) |

Also fixed: «پروژکتور خورشیدی» (a 16-pack of deck lights → a solar floodlight), «لامپ ال ای دی ۱۰ وات» (a lamp
with no wattage → a 10 W lamp), «سیم ۴ مفتولی» (flexible «افشان» wire picked for a solid-wire request), «سیم ۲.۵»
by the metre (a 2×2.5 cable at 0.2× the typical metre price). The full before/after list is at the end.

## Rules added (all general, each explained in Persian where a listing is set aside)

Nothing is hidden: a listing caught by a rule stays in the options list as «جایگزین» (`differs`, with the sentence
in `conflict`) or «مشخصات کامل نیست» (`incomplete`, sentence in `diffLabel`); it is never auto-picked, never the
"closest alternative", and a product the user pins is taken as is. Code: `packages/core/src/requirement/plausibility.ts`
(pure, unit-tested), wired in `apps/server/src/adapter/engine.ts` (`kindContext`, `withKindIssues`) and
`apps/server/src/retrieval/catalog.ts` (`withWireUnitCheck` on wire pools, `headStats`).

1. **Title head = the kind of goods** (`other_kind`, differs). Persian noun phrases put the head noun first:
   «فیش آداپتور» is a plug, «کاور ایرپاد» a cover, «باتری … پاور بانک» a battery. The head is the first title word
   that names goods (digits, Latin codes, brand names incl. multi-word aliases, number / unit words, «خرید/قیمت/مدل…»,
   «مینی», phone product-line words are skipped; «آ» folded to «ا»). A head is *foreign* to the listing's category
   when (a) the request does not contain it and it is not in the category's vocabulary (category-name words,
   hand-written synonyms, sub-kind table), (b) it heads **< 5 %** of the category's listings, and (c) the category
   where it heads the most listings is another one. Sentence: «عنوان آگهی با «فیش» شروع می‌شود که بیشتر نام کالاهای
   دستهٔ «سایر کابل و تبدیل» است، نه «آداپتور»؛ به نظر کالای دیگری است». A blanked title («عنوان حذف‌شده…») cannot
   be identified → incomplete.
2. **Sub-kinds of mixed categories** (`other_kind`, differs). A hand-written vocabulary (same status as the
   synonyms table) for categories whose name joins distinct product types: «کلید و پریز» (switch / socket / plug),
   «هدفون، هدست و هندزفری» (headphones / headset / handsfree / AirPods-type), «ساعت و مچ بند هوشمند», «چراغ و
   پروژکتور خورشیدی», «پروژکتور و وال واشر», «کیف و کاور گوشی». When the request names exactly one type, a listing
   headed by another type differs: «این آگهی «کلید» است، نه «پریز»». A request naming two («کلید و پریز») accepts
   both. Categories that join synonyms («سیم و کابل», «لپ تاپ و نوت بوک», «پاوربانک و شارژر همراه», «کتانی و کفش
   اسپرت») are deliberately not in the table.
3. **Roll vs metre price** (`unit_unclear`, incomplete; offer flag `unit_mismatch`). For one wire (section ×
   cores) each offer's price is converted to a per-metre price by its listing's own unit (a 100 m roll / 100) and the
   group median (≥ 3 offers) is the typical per-metre price. The units are 100× (two decades) apart; an offer more
   than **100^(1/3) ≈ ×4.6** from the typical price is outside the third of that distance nearest to its stated unit
   (it fits neither unit, or the other one). That offer's price is not used (seller row: price null + «قیمت این
   فروشنده با واحد فروش آگهی جور نیست؛ در جمع حساب نمی‌شود»); a listing left with no consistent price is
   «مشخصات کامل نیست» with «آگهی «حلقهٔ ۱۰۰ متری» است ولی قیمتش به قیمت یک متر از همین سیم می‌خورد؛ واحد فروش روشن
   نیست». Cores unknown / small group: judged against every judged core count of the same section; section unknown:
   against the listing's own offers (≥ 3).
4. **Stated specs are constraints** (no more silent drops). Extractor values that existed but had no engine
   attribute are mapped (`apps/server/src/adapter/mapping.ts`): `power_w` (watts: lighting, chargers, power banks,
   adapters), `capacity_mah` (power banks), `wire_strand` (افشان / مفتولی); `screen_inch` is read from any title at
   query time («۵۵ اینچ», core `screenInchOf`) and from the request. In the power-bank domain a single bare number of
   1,000–100,000 («پاوربانک ۲۰۰۰۰») is the capacity. These attributes are not asked as facet questions
   (`askable: false`), they only apply when the user states them; a listing that does not state the value is
   «مشخصات کامل نیست» (never auto-picked), one that states another value differs.

### Evidence for the two numbers

**5 % head share (rule 1).** Every title head of the 22 demo categories that is outside the category vocabulary and
whose home is another category, by its share of the category's listings (full snapshot):

| share in the category | heads (listings) | examples |
|---|---|---|
| 10–20 % | 1 (146) | «چراغ» in پروژکتور و وال واشر 10.5 % — an established name (floodlight «چراغ پروژکتور») |
| 5–10 % | 2 (128) | «اداپتور» in شارژر گوشی 9.1 %, «ترانس» in منبع تغذیه سوییچینگ 8.3 % — established names |
| 3–5 % | 3 (97) | «اداپتور» in منبع تغذیه 4.6 %, «شارژر» in آداپتور برق 4.3 %, «چراغ» in لامپ LED 3.9 % — another kind of goods |
| 1–3 % | 7 (176) | «محافظ» (surge protectors) and «کادر» (frames) in کلید و پریز, «ست» in watches, «هالوژن» in panel lights, «فیش» in adapters 1.1 % |
| < 1 % | 172 (291) | «کاور» in smart watches, «باتری» in power banks, «کارتن» in headphones, «پک»… |

The threshold sits in the gap between the established aliases (≥ 8.3 %) and the other-kind heads (≤ 4.6 %). The
one debatable case on the excluded side is «اداپتور» listings in the switching-PSU category (34 listings): they stay
visible as «جایگزین» for a «منبع تغذیه» request.

**×4.6 (rule 3).** Offers of «سیم و کابل برق ساختمان» listings with a title-stated section, cores and unit (1,798
offers; 1,073 on roll listings), as the ratio of their per-metre price to their group's typical per-metre price
(log10 bins of 0.25, bin centres): roll listings show a mode around 10^-2 (≈ 270 offers: a roll listing carrying a
one-metre price), a valley at 10^-1.5…10^-0.75 (16, 10, 7, 7 offers per bin) and the main mode at 10^-0.5…10^0.5
(≈ 750 offers). Metre listings mirror it with a small mode around 10^2 (metre listings priced like a roll).
100^(1/3) is the inner third of the 100× gap; it keeps the main mode (aluminium / CCA / cheap brands at 0.3×,
premium at 3×) and sets aside the valley, where a price fits neither unit. With the fallbacks (cores unknown,
section unknown) the rule judges 1,958 offers: 395 (327 on roll listings, 68 on metre listings) lose their price
and 89 listings of 5,274 end up «unit unclear».

## Invariants kept

- No suggestion is labelled exact; used / refurbished / replica listings are never auto-picked (unchanged policy,
  re-asserted by the new regression suite); compat findings unchanged (no new certainty: the rules only REMOVE
  listings from the automatic pick).
- Unknown is not guessed: a listing that does not state a requested spec is «incomplete», a unit we cannot trust is
  «incomplete», an unreadable title is «incomplete».
- The five contract scenarios (contract-real) and all earlier suites pass unchanged; only `mapping.test.ts` was
  updated for the newly mapped attributes.
- Latency (real-data suite, CCTV job): resolve p50 12 → 15 ms. The title-head counts are one pass over all titles
  (~2 s) built by the prewarm 10k listings per event-loop turn (a decision call during that pass finishes it).

## G1a follow-up: compatibility correctness (independent verification, 2026-10-22)

An independent verifier found that the CCTV job's first suggestion could hold a compatibility **conflict inside a
«complete» total**. Re-run of this audit (same 61 requests, settle-all) after the fix: only the CCTV job changed.

| # | item (CCTV job, everything settled) | before | after | eligible before→after |
|---|---|---|---|---|
| 2 | دوربین داهوا ۲ مگاپیکسل | DH-HAC-HDW1200RP, HDCVI (1,220,000) | = same | 291→139 (cameras kept to the analog family of the pick) |
| 3 | ضبط‌کننده ۴ کانال | DHI-NVR 2104HS (1,130,000): an **NVR next to an HDCVI camera** (conflict line, complete total) | دستگاه دی وی آر ۴ کانال (4,800,000) | 154→123 |
| 5 | آداپتور | «آداپتور ۲ آمپر وارداتی» (62,000): **voltage not in the listing** | «آداپتور 12 ولت 500 میلی آمپر ترانسی» (210,000, product 4958) | 577→187 |

Other verifier repros (all now regression tests, `apps/server/test/compat-guard-real.test.ts`):
- answers «آنالوگ» + «۰٫۵ آمپر» picked «آداپتور 4.2V» (and «۱ آمپر» a 7.7 V one) next to the cameras, line level
  `conflict`, total «جمع ۴ مورد». Now the adapter asks its voltage (compat-critical, «۱۲ ولت (معمول برای دوربین)»
  first); meanwhile the plan says «فقط ۳ از ۴ مورد» · «منتظر انتخاب: آداپتور». One more tap (12 V) picks product
  4958 (210,000).
- the fewest-stops variant picked «آداپتور POE ADP12-48» (voltage not stated, PoE) for an HDCVI system. Now every
  adapter the plan may use next to cameras states 12 V.
- «گوشی سامسونگ A56 زیر ۵۰ میلیون» / «گوشی آیفون ۱۵ استوک» returned «جایگزین» with no product and no reason. Now
  `noMatch`: «هیچ مدلی با بودجهٔ ۵۰ میلیون پیدا نشد؛ ارزان‌ترین مدل ۱۰۰٫۶ میلیون تومان است» + «بودجه را بردار» + the
  three nearest A56 listings; «هیچ آگهی کارکرده یا استوکی پیدا نشد؛ ۲ مدل نو مطابق بقیهٔ خواسته‌ات هست» + «شرط
  «کارکرده (استوک)» را بردار». Nothing is picked on the user's behalf.

What changed (code: `packages/core/src/compat/{rules,index}.ts`, `apps/server/src/adapter/engine.ts`):
1. **12 V is derived, as an assumption.** With cameras in the list, an adapter whose voltage the user did not state
   gets `voltage_v = 12` (source compat, rule `camera_adapter_12v`). A listing stating another voltage is «جایگزین»
   with «… (فرض عمومی: دوربین‌ها معمولاً ۱۲ ولت می‌خواهند؛ تأیید نشده)»; one without a voltage (incl. PoE) is
   «مشخصات کامل نیست». The chip reads «۱۲ ولت (فرض عمومی برای «دوربین…»؛ تأیید نشده)». The voltage is asked as a
   compat-critical question; «کافیه» keeps the assumption, «فرقی نمی‌کند» lifts it (any listing-stated voltage), a
   voltage the user chose is never reported as a conflict (only as «نامشخص» with the assumption spelled out).
2. **Plan guard.** After planning, any `conflict` finding that involves an automatic pick (not pinned, not a typed
   model code, and whose linking attribute the user did not state) is repaired: the rule adds constraints that follow
   the other item's pick (an HDCVI camera → recorder «XVR / DVR», cameras kept to the analog family; chip «… (برای جور
   شدن با «…» در برنامه)»), the list is re-resolved, and the conflicting products become «جایگزین» with the reason.
   If repairs cannot remove it (≤ 3 rounds), the automatic pick is taken out (state «نیاز به اطلاعات», not counted),
   so a conflict never coexists with a complete total. A non-selected plan that would hold such a conflict is not
   offered as an alternative. `/api/resolve` returns the guarded cards (identical to `/api/plan` `items`).
3. A conflict between two things the user stated or pinned (a pinned A57 case next to a phone stated as A56) is the
   user's call: it stays visible as «ناسازگار» and nothing they chose is changed.
4. Also: before a wire's sale unit is chosen the item line states no price range (it mixed per-metre and per-roll
   prices); the missing line is grouped: «پیدا نشد: …» · «منتظر انتخاب: …» · «قیمت ثبت نشده: …».

Unchanged on purpose: a bare «آداپتور» request without cameras (#15) still picks «آداپتور ۲ آمپر وارداتی»: no
compatibility rule applies without cameras and the request states nothing else (a loose request; the engine asks the
amps question unless settled). Latency (real-data suite): resolve p50 16 → 21 ms (it now runs the planner's guard).

## G3a follow-up: absent items, list = plan, contradictory answers (independent verification, 2026-10-22)

Reproduce the sweep (in process, read-only; exits 1 when a must-be-0 counter is not 0):

```
DATABASE_PATH=/path/to/market.sqlite npx tsx apps/server/scripts/sweep-conflicts.ts [--json out.json]
```

44 lists (the verifier's 40 CCTV / phone / charger lists + 2 stated contradictions + 2 lists with absent items) × 6
answer strategies (settle, skip, first, last, «فرقی نمی‌کند», seeded random) × 2 variants, up to 8 answer rounds,
then every offered alternative of the final state. Every plan is checked.

| counter (plans) | before (c046718) | after |
|---|---|---|
| plans checked | 1,831 | 1,812 |
| plans with a conflict line | 99 | 93 (all the user's own choices) |
| … with complete coverage | 83 | 76 |
| conflict / lifted assumption beside a total **without** the marker or `hasConflict` (must be 0) | 99 | **0** |
| conflict line not from the user's own choices (must be 0) | 99 (not marked) | **0** |
| superlative reason («ارزان‌ترین ترکیب…») beside a conflict (must be 0) | 71 | **0** |
| item card ≠ product / price / state on its stop line (must be 0) | 1,355 of 4,029 lines | **0** of 3,798 |
| absent item (parser: not_in_catalog) with a product or a stop line (must be 0) | 188 | **0** |
| plans with a lifted 12 V assumption (all marked «بدون تأیید سازگاری») | — | 198 |

The 93 remaining conflict plans: «۴ دوربین تحت شبکه و دی وی آر ۸ کانال» and «۴ دوربین AHD و ان وی آر ۴ کانال»
(typed contradictions, 43 plans each) and 7 plans of the CCTV job where the «last» strategy answers the camera's
signal and the recorder's question in the same round (two answers given before either was applied). Each
carries `hasConflict`, «— ناسازگاری دارد» on the total line, a neutral reason and «(از انتخاب‌های خودت)» on the line.

What changed:
1. **Absent items are terminal.** A parser item without categories (note `not_in_catalog`) is never searched by raw
   text (`retrieve` `noVote`), never asked about, never picked (also after «کافیه»), never counted: «پیدا نشد» with
   `nearbyCategories` + `nearbyCategoryIds` (new). It becomes a normal item only when the client sends it again with a
   picked `categoryIds`. A chip-form item without categories gets a category only from the synonyms or from a
   full-text vote whose winning category shares real words with the request (the `notfound.ts` evidence rule); no
   category = no pool (only a pin or an exact typed model code). 31 food / household / absurd words, settled and not:
   0 picks (`apps/server/test/g3a-real.test.ts`). «مرغ» used to settle on «بستنی گربه پرسا» (39,000), «برنج» on «شیر
   برقی … دینامیک» (10,000).
2. **The list shows what the plan buys.** `/api/plan` `items[]` and `/api/resolve` (same state, variant included) show,
   for every assigned item, the product, state, rule and unit price of its stop line; when the plan buys another
   eligible model than the overall cheapest, the rule reads «ارزان‌ترین مطابق خواسته در توقف‌های همین برنامه».
   Property test: 5 scenarios × every variant (null, fewest, each alternative).
3. **Contradictory answers.** (a) Question options are filtered by their compat consequences against what the user
   fixed on the other items (stated, answered or pinned; core `answerConflict`): no IP option next to a stated DVR,
   no analog option next to an NVR or after the recorder was answered «تحت شبکه», no channel count below the cameras.
   (b) Two fixed things that contradict each other (core `statedConflicts`) give both cards a Persian `conflictNote`
   and no question deepens them. (c) Any plan with a conflict line has `hasConflict: true`, `totalMarker`
   «ناسازگاری دارد» appended to `totalLine` («جمع ۳ مورد: ۱۲٫۵ میلیون تومان — ناسازگاری دارد»), a reason without a
   superlative, and the line says «(از انتخاب‌های خودت)» (`fromUserChoice`).
4. **Lifted 12 V assumption.** An adapter voltage other than 12 V that the user chose or allowed («فرقی نمی‌کند») keeps
   their choice; the line is `assumptionLifted` with the label «فرض عمومی کنار گذاشته شد؛ تأیید نشده», and the plan
   carries `compatUnverified` and «— بدون تأیید سازگاری».
5. `sellerCount` counts sellers with a usable price (`sellerCountLabel` «۳ فروشنده با قیمت»; «… بدون قیمت» when none
   has one); `/api/options` `modelTotal` is the card's pool (eligible count, «۷ مدل»), with `eligibleCount` and
   `poolLabel` («۷ مدل مطابق خواسته از ۵٬۲۷۴ مدل بررسی‌شده»).

Audit re-run (same 61 requests): two rows changed. «هارد بنفش ۴ ترابایت»: the card now shows the WD Purple the plan
buys at the same price (21,000,000) instead of the Seagate; «اپل واچ»: the parser marks it not_in_catalog, so it is
now «پیدا نشد» (with the catalog's biggest categories) instead of a no-name smart watch taken from a raw-text vote; the
fix belongs in the parser (map «اپل واچ» to «ساعت و مچ بند هوشمند»).

## Remaining known-bad or debatable picks (not fixed, with the reason)

| request | pick after | why it stays |
|---|---|---|
| سیم برق ۱۰۰ متر (no section) | کابل برق افشان 1*4 کرمان کابل رادین 100 متری (109,000) | the title's «1*4» is ambiguous, so the section is unknown; the listing has only 2 offers (109,000 and 11,546,000): no majority to judge the unit. Data-quality issue. |
| سیم ۴ مفتولی by the metre / سیم ۲.۵ | کابل مفتولی 4×3 (3-core cable) / 2-core cable earlier | the parser deliberately does not infer «1 core» from «سیم» (W2 decision); bazaar usage says «سیم ۲.۵» = single core. Needs a product decision, not a price rule. |
| سیم ۲.۵ / ۶ / ۱.۵ by the roll | 1,465,000 / 3,945,000 / 1,000,000 | 0.25–0.3× the typical roll price: inside the tolerance (cheap aluminium / CCA listings look like this); plausible, not proven wrong. |
| کلید تک پل | مینیاتوری 16 آمپر تک پل LS (a circuit breaker) | category vote: FTS hits for «کلید … پل» are dominated by breakers, although 55 of 65 titles *starting* with «کلید تک پل» are wall switches. Parser vote change with wide blast radius; left for a parser unit. |
| کفش ورزشی | کفش زنانه مدل m364 (کفش کالج زنانه) | category vote picks «کفش کالج زنانه»; «ورزشی» ≈ «اسپرت» is not in the synonyms table (needs a data build). |
| اپل واچ | a no-name smart watch | the parser returns «not in catalog» and no brand constraint for «اپل واچ»; retrieval then votes the category from FTS. Parser gap. |
| کلید و پریز (one combined item) | کلید بین راهی (18,000) | both types are named, so both are accepted; an inline cord switch is a «کلید». The parser keeps «کلید و پریز» as one protected pair. |
| پاوربانک | پاوربانک وایرلس اپل ۱۰۰۰ میلی‌آمپر (890,000) | a real power-bank listing; «1000 mAh» is probably a typo for 10000 in the listing (data quality). |
| لپ تاپ | HP EliteBook 840 G1 (25.5 M) | an old model, very likely a stock unit, but the title does not say so; we do not guess condition. |
| گوشی موبایل | نوکیا 105 (1,335,000) | a real phone; the cheapest phone is a feature phone. Loose request; the engine asks a question unless settled. |
| ایرپاد | ایرپاد بی سیم سامسونگ K30 | right kind; the title says «ایرپاد» for a Samsung-branded TWS (marketplace naming). |
| منبع تغذیه requests | «اداپتور…» PSU listings set aside (34) | rule 1 at 4.6 %; debatable alias, visible as «جایگزین». |
| any category | rule 1 needs the head in the first five title words | titles that start with a shop slogan («️هوالرزاق…») are set aside as another kind (shoes: 7 listings). |

## Full before / after (73 audited items)

`= same` means the pick did not change. Eligible counts drop where listings were set aside by the rules or where a
stated spec now applies.

| # | request › item | before: pick (toman) | after: pick (toman) | eligible before→after |
|---|---|---|---|---|
| 1 | دوربین داهوا ۲ مگاپیکسل | دوربین مداربسته داهوا مدل DH-HAC-HDW1200RP (1,220,000) | = same | 291→291 |
| 2 | ۴ دوربین داهوا ۲ مگاپیکسل، ضبط… › دوربین داهوا ۲ مگاپیکسل | دوربین مداربسته داهوا مدل DH-HAC-HDW1200RP (1,220,000) | = same | 291→291→139 (G1a) |
| 3 | ۴ دوربین داهوا ۲ مگاپیکسل، ضبط… › ضبط‌کننده ۴ کانال | دستگاه 4 کانال داهوا مدل DHI-NVR 2104HS- i2 (1,130,000) | G1a: دستگاه دی وی آر ۴ کانال ۵ مگاپیکسل (4,800,000) | 155→154→123 (G1a) |
| 4 | ۴ دوربین داهوا ۲ مگاپیکسل، ضبط… › هارد ۲ ترابایت | هارد دیسک اینترنال وسترن دیجیتال مدل Purple ظرفیت ۲ ترابایت (10,400,000) | = same | 51→51 |
| 5 | ۴ دوربین داهوا ۲ مگاپیکسل، ضبط… › آداپتور | فیش آداپتور نری سر زرد دیسمکن 1.7 میلی متری (30,000) | آداپتور ۲ آمپر وارداتی (62,000); G1a: آداپتور 12 ولت 500 میلی آمپر ترانسی (210,000) | 623→577→187 (G1a) |
| 6 | دوربین مداربسته | دوربین مداربسته مدل No Name DP8000 (589,000) | = same | 3460→3452 |
| 7 | دوربین هایک ویژن ۵ مگاپیکسل | دوربین مداربسته هایک ویژن مدل DS-2CE56H0T-IT1F (1,567,000) | = same | 44→44 |
| 8 | دوربین بالت تحت شبکه | دوربین مداربسته بالت تحت شبکه DH-IPC-HFW1230-S1P (3,200,000) | = same | 103→103 |
| 9 | دوربین دام AHD | دوربین مداربسته دام 2 مگاپیکسل دید در شب رنگی AHD مدل D-3200-F (1,450,000) | = same | 61→61 |
| 10 | دی وی آر ۸ کانال | دستگاه دی وی آر ۸ کانال ۵ مگاپیکسل نواتک مدل 8005F4-S (6,800,000) | = same | 65→65 |
| 11 | ان وی آر ۸ کانال | دستگاه 8 کانال هایک ویژن مدل DS-7608NI-K1 (6,000,000) | = same | 47→47 |
| 12 | ضبط کننده ۱۶ کانال | دستگاه DVR هایک ویژن DS-7216HGHI-K1 (5,890,000) | = same | 200→200 |
| 13 | هارد ۱ ترابایت | هارد دیسک اینترنال سیگیت مدل ST1000DM003 ظرفیت ۱ ترابایت (5,000,000) | = same | 72→71 |
| 14 | هارد بنفش ۴ ترابایت | هارد دیسک اینترنال سیگیت ۴ ترابایت بنفش (21,000,000) | = same | 27→27 |
| 15 | آداپتور | فیش آداپتور نری سر زرد دیسمکن 1.7 میلی متری (30,000) | آداپتور ۲ آمپر وارداتی (62,000) | 623→577 |
| 16 | آداپتور ۱۲ ولت ۲ آمپر | آداپتور 12 ولت 2 آمپر (290,000) | = same | 63→60 |
| 17 | آداپتور ۱۲ ولت | آداپتور 12 ولت 500 میلی آمپر ترانسی (210,000) | = same | 198→187 |
| 18 | منبع تغذیه ۱۲ ولت ۱۰ آمپر | منبع تغذیه سوئیچینگ 12 ولت 10 امپر کف خواب کد s120-12 (700,000) | = same | 36→28 |
| 19 | سیم ۲.۵ [roll] | سیم افشان سیمیا ۲.۵ میلیمتر طول ۱۰۰ متر با روکش PVC (45,000) | سیم برق افشان 1 در 2/5 حلقه 100 متری البرز ابهر کاسیم (1,465,000) | 115→107 |
| 20 | سیم ۲.۵ [meter] | سیم برق دو رشته خانگی البرز افشان ۲ در ۲.۵ متراژ ۱ متر با روکش PVC (29,000) | سیم افشان مسی 2.5 پژواک البرز (یک متر) (58,939) | 46→42 |
| 21 | سیم برق ۱.۵ افشان [roll] | سیم افشان 1.5×1 افشار نژاد خراسان حلقه 100 متری (29,000) | سیم افشان کرمان رادین سایز ۱.۵ میلیمتر طول ۱۰۰ متر (1,000,000) | 143→106 |
| 22 | سیم برق ۱.۵ افشان [meter] | سیم برق افشان ۱.۵ زرتافته کرمان ۱ متری (26,000) | = same | 49→21 |
| 23 | سیم ۴ مفتولی [roll] | سیم افشان ۴ میلیمتر افشار نژاد کلاف ۱۰۰ متری با روکش PVC (49,500) | سیم مفتول ۱ در ۴ البرز الکتریک نور کلاف ۱۰۰ متری با روکش PVC (21,412,300) | 76→1 |
| 24 | سیم ۴ مفتولی [meter] | سیم برق افشان 4*1 زرتافته کرمان 1 متری (81,000) | کابل مفتولی (زمینی) مسی نمره 4×3 برند افشار نژاد خراسان ( یک متر ) (427,160) | 43→2 |
| 25 | کابل ۳ در ۲.۵ [roll] | کابل افشان پرتو الکتریک ۲.۵*۳ طول ۱۰۰ متر (103,800) | کابل برق افشان ۳ در ۲.۵ (۲.۵*۳) کرمان کابل رادین - به صورت کلاف ۱۰۰ مت (8,450,000) | 15→14 |
| 26 | کابل ۳ در ۲.۵ [meter] | کابل زمینی 2.5*3 افشار نژاد خراسان - متراژ: 1 متر (173,000) | = same | 12→12 |
| 27 | سیم ۶ [roll] | سیم افشان ۶ میلیمتر سیمیا کلاف ۱۰۰ متری (28,000) | سیم برق هادی نور البرز ۱ در ۶ طول ۱۰۰ متر رنگ آبی (3,945,000) | 73→65 |
| 28 | سیم ۶ [meter] | سیم افشان افشار نژاد خراسان سطح مقطع 6 /  یک متری (69,900) | = same | 44→43 |
| 29 | سیم برق ۱۰۰ متر | سیم افشان ۱ میلیمتر خراسان افشارنژاد طول ۱۰۰ متر (20,500) | کابل برق افشان 1*4 کرمان کابل رادین 100 متری (109,000) | 640→581 |
| 30 | سیم برق ۲/۵ افشان ۵۰ متر، کلید… › سیم برق ۲/۵ افشان ۵۰ متر [roll] | سیم افشان سیمیا ۲.۵ میلیمتر طول ۱۰۰ متر با روکش PVC (45,000) | سیم برق افشان 1 در 2/5 حلقه 100 متری البرز ابهر کاسیم (1,465,000) | 115→92 |
| 31 | سیم برق ۲/۵ افشان ۵۰ متر، کلید… › کلید و پریز [roll] | کلید بین راهی (18,000) | = same | 1242→1095 |
| 32 | سیم برق ۲/۵ افشان ۵۰ متر، کلید… › سیم برق ۲/۵ افشان ۵۰ متر [meter] | سیم برق دو رشته خانگی البرز افشان ۲ در ۲.۵ متراژ ۱ متر با روکش PVC (29,000) | سیم افشان مسی 2.5 پژواک البرز (یک متر) (58,939) | 46→25 |
| 33 | سیم برق ۲/۵ افشان ۵۰ متر، کلید… › کلید و پریز [meter] | کلید بین راهی (18,000) | = same | 1242→1095 |
| 34 | کلید و پریز | کلید بین راهی (18,000) | = same | 1242→1095 |
| 35 | کلید تک پل | مینیاتوری 16 آمپر تک پل LS (46,000) | = same | 940→940 |
| 36 | پریز برق | کلید بین راهی (18,000) | پریز برق لگرند ارت دار قرمز و سفید (33,000) | 1242→554 |
| 37 | کلید دوپل | کلید دوپل مدل توران نیلسون (91,800) | = same | 39→39 |
| 38 | پریز ارت | پریز برق لگرند ارت دار قرمز و سفید (33,000) | = same | 204→135 |
| 39 | پروژکتور ۵۰ وات | پرژکتور ۵۰ وات بیلبوردی چینی (300,000) | = same | 1394→209 |
| 40 | پروژکتور ال ای دی ۱۰۰ وات | پرژکتور ۵۰ وات بیلبوردی چینی (300,000) | پروژکتور ال ای دی ای لایت ۱۰۰ وات کد IP66 (400,000) | 131→17 |
| 41 | لامپ ال ای دی ۱۰ وات | لامپ اف بی ال (22,000) | لامپ ال ای دی 10 وات مدل کلاسیک رنگی برند دلتا پایه E27 رنگ قرمز کد DE (49,000) | 934→31 |
| 42 | چراغ پنلی سقفی | پنل توکار 5 وات مدل بتا داتیس (37,950) | = same | 2370→2295 |
| 43 | پروژکتور خورشیدی | بسته YHOME 16 چراغ های خورشیدی برای عرشه، چراغ های عرشه خورشیدی در فضا (245,000) | پرژکتورخورشیدی روشنایی لامپ خورشیدی (685,000) | 324→149 |
| 44 | گوشی سامسونگ A56 با قاب و گلس… › گوشی سامسونگ A56 | گوشی سامسونگ A56 5G / حافظه 128 رم 8 گیگابایت (100,600,000) | = same | 3→3 |
| 45 | گوشی سامسونگ A56 با قاب و گلس… › قاب | قاب شفاف شاین طرح دار آلبالو برجسته مناسب برای گوشی Samsung Galaxy A56 (245,000) | = same | 30→27 |
| 46 | گوشی سامسونگ A56 با قاب و گلس… › گلس | گلس آنتی استاتیک سامسونگ A56 با جنس شیشه (130,000) | = same | 5→5 |
| 47 | گوشی آیفون ۱۳ | گوشی اپل دو سیم iPhone 13 (Not Active) / حافظه 128 گیگابایت (235,000,000) | = same | 2→2 |
| 48 | گوشی شیائومی ردمی نوت ۱۳ | گوشی شیائومی Redmi Note 13 4G / حافظه 512 رم 8 گیگابایت (122,900,000) | = same | 1→1 |
| 49 | گوشی سامسونگ ۲۵۶ گیگ | گوشی سامسونگ (ویتنام) A25 5G / حافظه 256 رم 8 گیگابایت (75,000,000) | = same | 33→33 |
| 50 | گوشی موبایل | گوشی نوکیا (بدون گارانتی) 2022 105 / حافظه 4 مگابایت (1,335,000) | = same | 687→681 |
| 51 | قاب آیفون ۱۳ | کاور طرح عروسکی مناسب برای گوشی موبایل اپل iPhone 13/14 (180,000) | = same | 31→31 |
| 52 | گلس سامسونگ A56 | گلس آنتی استاتیک سامسونگ A56 با جنس شیشه (130,000) | = same | 5→5 |
| 53 | محافظ صفحه آیفون ۱۵ | گلس آنتی استاتیک گوشی آیفون ۱۵ گرند (299,000) | = same | 8→8 |
| 54 | شارژر سامسونگ | شارژر سامسونگ مدل EP TA200 توان 15 وات دو پین (280,000) | = same | 184→174 |
| 55 | شارژر ۲۵ وات | آداپتور 4.2V فیش کوچک 500 میلی آمپر چراغ قوه (148,000) | شارژر سامسونگ مدل EP-TA800 توان 25 وات سه پین (350,000) | 713→66 |
| 56 | کابل شارژ تایپ سی | کابل تایپ سی type-c ، مدل x17 سوپر فست 6 آمپر (76,000) | = same | 258→252 |
| 57 | هندزفری بلوتوثی | هندزفری بی سیم تک گوش HI-FI مدل M11 (271,000) | = same | 584→147 |
| 58 | هدفون | هندزفری سامسونگ مدل HS3303WE (115,000) | هدفون بی سیم سی بای مدل C2N (137,000) | 1323→793 |
| 59 | ایرپاد | هندزفری سامسونگ مدل HS3303WE (115,000) | ایرپاد بی سیم سامسونگ مدل K30 (185,000) | 1323→84 |
| 60 | پاوربانک ۲۰۰۰۰ | باتری لیتیوم پلیمر پاور بانک ظرفیت 10000 میلی آمپر (750,000) | پاوربانک کینگ پاور مدل KPG-205 ظرفیت 20000 میلی آمپر (1,576,500) | 755→206 |
| 61 | پاوربانک | باتری لیتیوم پلیمر پاور بانک ظرفیت 10000 میلی آمپر (750,000) | پاوربانک وایرلس اپل ۱۰۰۰ میلی‌آمپر (890,000) | 755→750 |
| 62 | ساعت هوشمند | کاور ایرپاد پرو ضدضربه مدل Eggshell airpod pro (389,000) | ساعت هوشمند T10000 Ultra3 با بند سیلیکونی (1,108,800) | 451→429 |
| 63 | ساعت مچی مردانه | ساعت مردانه نایکی آنالوگ (800,000) | = same | 1214→1209 |
| 64 | اپل واچ | کاور ایرپاد پرو ضدضربه مدل Eggshell airpod pro (389,000) | ساعت هوشمند T10000 Ultra3 با بند سیلیکونی (1,108,800) | 451→446 |
| 65 | لپ‌تاپ ایسوس | لپ تاپ ایسوس E410KA / 4GB RAM / 256GB SSD / Celeron N4500 (74,198,940) | = same | 134→134 |
| 66 | لپ تاپ لنوو | نوت‌بوک لنوو T450S سایز ۱۴ اینچ Core i5 رم ۸ گیگابایت (32,500,000) | = same | 133→133 |
| 67 | لپ تاپ | لپ تاپ HP مدلEliteBook 840 G1(I5(4u)/8/500/INTEL) (25,500,000) | = same | 479→479 |
| 68 | تلویزیون سامسونگ ۵۵ اینچ | تلویزیون سامسونگ T5300 سایز ۴۳ اینچ کیفیت Full HD نوع LED (65,900,000) | تلویزیون هوشمند سامسونگ مدل U8000F سایز ۵۵ اینچ Ultra HD 4K (99,500,000) | 62→13 |
| 69 | تلویزیون ال جی | 8050 UR سایز 55ال جی (85,500,000) | = same | 67→67 |
| 70 | تلویزیون | تلویزیون صنام مدل SLE-24M116 سایز ۲۴ اینچ (22,500,000) | = same | 358→357 |
| 71 | کفش ورزشی | کفش زنانه مدل m364 (979,800) | = same | 243→229 |
| 72 | کفش مردانه | کفش اداری مردانه ماهان از چرم (2,290,000) | = same | 196→188 |
| 73 | کتانی نایکی | کتانی نایکی زنانه تمپو (1,280,000) | = same | 153→153 |

## After: full audit output (script format)

Re-run after G1a (2026-10-22; counts are those of the guarded item cards, as `/api/resolve` returns them).

| # | request › item | state | pick (price) | pick category | elig/incompl/cand | rank | eligible median | flags |
|---|---|---|---|---|---|---|---|---|
| 1 | دوربین داهوا ۲ مگاپیکسل | suggested | دوربین مداربسته داهوا مدل DH-HAC-HDW1200RP (1,220,000) | دوربین مدار بسته | 291/933/3467 | 1 | 3,765,000 |  |
| 2 | ۴ دوربین داهوا ۲ مگاپیکسل، ضبط‌کننده ۴ کانال، هارد ۲ ترابایت و آداپتور › دوربین داهوا ۲ مگ | suggested | دوربین مداربسته داهوا مدل DH-HAC-HDW1200RP (1,220,000) | دوربین مدار بسته | 139/867/3467 | 1 | 2,975,000 |  |
| 3 | ۴ دوربین داهوا ۲ مگاپیکسل، ضبط‌کننده ۴ کانال، هارد ۲ ترابایت و آداپتور › ضبط‌کننده ۴ کانال | suggested | دستگاه دی وی آر ۴ کانال ۵ مگاپیکسل (4,800,000) | ضبط کننده ویدیویی دوربین‌های نظارتی و امنیتی | 123/108/870 | 1 | 9,500,000 |  |
| 4 | ۴ دوربین داهوا ۲ مگاپیکسل، ضبط‌کننده ۴ کانال، هارد ۲ ترابایت و آداپتور › هارد ۲ ترابایت | suggested | هارد دیسک اینترنال وسترن دیجیتال مدل Purple ظرفیت ۲ ترابایت (10,400,000) | هارد دیسک اینترنال | 51/12/471 | 1 | 24,999,000 |  |
| 5 | ۴ دوربین داهوا ۲ مگاپیکسل، ضبط‌کننده ۴ کانال، هارد ۲ ترابایت و آداپتور › آداپتور | suggested | آداپتور 12 ولت 500 میلی آمپر ترانسی (210,000) | آداپتور برق | 187/73/628 | 1 | 550,000 |  |
| 6 | دوربین مداربسته | suggested | دوربین مداربسته مدل No Name DP8000 (589,000) | دوربین مدار بسته | 3452/2/3467 | 1 | 6,650,000 | cheap10 |
| 7 | دوربین هایک ویژن ۵ مگاپیکسل | suggested | دوربین مداربسته هایک ویژن مدل DS-2CE56H0T-IT1F (1,567,000) | دوربین مدار بسته | 44/950/3467 | 1 | 4,008,000 |  |
| 8 | دوربین بالت تحت شبکه | suggested | دوربین مداربسته بالت تحت شبکه DH-IPC-HFW1230-S1P (3,200,000) | دوربین مدار بسته | 103/93/267 | 1 | 11,350,000 |  |
| 9 | دوربین دام AHD | suggested | دوربین مداربسته دام 2 مگاپیکسل دید در شب رنگی AHD مدل D-3200-F (1,450,000) | دوربین مدار بسته | 61/1031/3467 | 1 | 2,912,270 |  |
| 10 | دی وی آر ۸ کانال | suggested | دستگاه دی وی آر ۸ کانال ۵ مگاپیکسل نواتک مدل 8005F4-S (6,800,000) | ضبط کننده ویدیویی دوربین‌های نظارتی و امنیتی | 65/73/870 | 1 | 10,950,000 |  |
| 11 | ان وی آر ۸ کانال | suggested | دستگاه 8 کانال هایک ویژن مدل DS-7608NI-K1 (6,000,000) | ضبط کننده ویدیویی دوربین‌های نظارتی و امنیتی | 47/88/870 | 1 | 15,000,000 |  |
| 12 | ضبط کننده ۱۶ کانال | suggested | دستگاه DVR هایک ویژن DS-7216HGHI-K1 (5,890,000) | ضبط کننده ویدیویی دوربین‌های نظارتی و امنیتی | 200/131/870 | 1 | 23,000,000 | nohead |
| 13 | هارد ۱ ترابایت | suggested | هارد دیسک اینترنال سیگیت مدل ST1000DM003 ظرفیت ۱ ترابایت (5,000,000) | هارد دیسک اینترنال | 71/12/471 | 1 | 13,157,280 |  |
| 14 | هارد بنفش ۴ ترابایت | suggested | هارد دیسک اینترنال سیگیت ۴ ترابایت بنفش (21,000,000) | هارد دیسک اینترنال | 27/10/471 | 1 | 35,800,000 |  |
| 15 | آداپتور | suggested | آداپتور ۲ آمپر وارداتی (62,000) | آداپتور برق | 577/2/628 | 1 | 647,500 | cheap10 |
| 16 | آداپتور ۱۲ ولت ۲ آمپر | suggested | آداپتور 12 ولت 2 آمپر (290,000) | آداپتور برق | 60/62/628 | 1 | 420,000 |  |
| 17 | آداپتور ۱۲ ولت | suggested | آداپتور 12 ولت 500 میلی آمپر ترانسی (210,000) | آداپتور برق | 187/73/628 | 1 | 550,000 |  |
| 18 | منبع تغذیه ۱۲ ولت ۱۰ آمپر | suggested | منبع تغذیه سوئیچینگ 12 ولت 10 امپر کف خواب کد s120-12 (700,000) | منبع تغذیه سوییچینگ | 28/148/743 | 1 | 1,675,000 |  |
| 19 | سیم ۲.۵ [roll] | suggested | سیم برق افشان 1 در 2/5 حلقه 100 متری البرز ابهر کاسیم (1,465,000) | سیم و کابل برق ساختمان | 107/1154/5274 | 1 | 9,580,000 |  |
| 20 | سیم ۲.۵ [meter] | suggested | سیم افشان مسی 2.5 پژواک البرز (یک متر) (58,939) | سیم و کابل برق ساختمان | 42/1180/5274 | 1 | 305,000 |  |
| 21 | سیم برق ۱.۵ افشان [roll] | suggested | سیم افشان کرمان رادین سایز ۱.۵ میلیمتر طول ۱۰۰ متر (1,000,000) | سیم و کابل برق ساختمان | 106/1235/5274 | 1 | 6,081,750 |  |
| 22 | سیم برق ۱.۵ افشان [meter] | suggested | سیم برق افشان ۱.۵ زرتافته کرمان ۱ متری (26,000) | سیم و کابل برق ساختمان | 21/1257/5274 | 1 | 250,000 |  |
| 23 | سیم ۴ مفتولی [roll] | suggested | سیم مفتول ۱ در ۴ البرز الکتریک نور کلاف ۱۰۰ متری با روکش PVC (21,412,300) | سیم و کابل برق ساختمان | 1/579/5274 | 1 | 21,412,300 |  |
| 24 | سیم ۴ مفتولی [meter] | suggested | کابل مفتولی (زمینی) مسی نمره 4×3 برند افشار نژاد خراسان ( یک متر ) (427,160) | سیم و کابل برق ساختمان | 2/600/5274 | 1 | 427,160 |  |
| 25 | کابل ۳ در ۲.۵ [roll] | suggested | کابل برق افشان ۳ در ۲.۵ (۲.۵*۳) کرمان کابل رادین - به صورت کلاف ۱۰۰ متری می باشد. (8,450,000) | سیم و کابل برق ساختمان | 14/750/5274 | 1 | 33,118,000 |  |
| 26 | کابل ۳ در ۲.۵ [meter] | suggested | کابل زمینی 2.5*3 افشار نژاد خراسان - متراژ: 1 متر (173,000) | سیم و کابل برق ساختمان | 12/775/5274 | 1 | 309,610 |  |
| 27 | سیم ۶ [roll] | suggested | سیم برق هادی نور البرز ۱ در ۶ طول ۱۰۰ متر رنگ آبی (3,945,000) | سیم و کابل برق ساختمان | 65/993/5274 | 1 | 30,800,000 |  |
| 28 | سیم ۶ [meter] | suggested | سیم افشان افشار نژاد خراسان سطح مقطع 6 / یک متری (69,900) | سیم و کابل برق ساختمان | 43/1016/5274 | 1 | 577,000 |  |
| 29 | سیم برق ۱۰۰ متر | suggested | کابل برق افشان 1*4 کرمان کابل رادین 100 متری (109,000) | سیم و کابل برق ساختمان | 581/4121/5274 | 1 | 10,992,000 | cheap10 |
| 30 | سیم برق ۲/۵ افشان ۵۰ متر، کلید و پریز › سیم برق ۲/۵ افشان ۵۰ متر [roll] | suggested | سیم برق افشان 1 در 2/5 حلقه 100 متری البرز ابهر کاسیم (1,465,000) | سیم و کابل برق ساختمان | 92/1122/5274 | 1 | 9,300,000 |  |
| 31 | سیم برق ۲/۵ افشان ۵۰ متر، کلید و پریز › کلید و پریز [roll] | suggested | کلید بین راهی (18,000) | کلید و پریز | 1095/0/1242 | 1 | 436,761 | cheap10 |
| 32 | سیم برق ۲/۵ افشان ۵۰ متر، کلید و پریز › سیم برق ۲/۵ افشان ۵۰ متر [meter] | suggested | سیم افشان مسی 2.5 پژواک البرز (یک متر) (58,939) | سیم و کابل برق ساختمان | 25/1144/5274 | 1 | 268,400 |  |
| 33 | سیم برق ۲/۵ افشان ۵۰ متر، کلید و پریز › کلید و پریز [meter] | suggested | کلید بین راهی (18,000) | کلید و پریز | 1095/0/1242 | 1 | 436,761 | cheap10 |
| 34 | کلید و پریز | suggested | کلید بین راهی (18,000) | کلید و پریز | 1095/0/1242 | 1 | 436,761 | cheap10 |
| 35 | کلید تک پل | suggested | مینیاتوری 16 آمپر تک پل LS (46,000) | کلید و فیوز مینیاتوری | 940/0/940 | 1 | 1,092,100 | cheap10 |
| 36 | پریز برق | suggested | پریز برق لگرند ارت دار قرمز و سفید (33,000) | کلید و پریز | 554/0/1242 | 1 | 464,800 | cheap10 |
| 37 | کلید دوپل | suggested | کلید دوپل مدل توران نیلسون (91,800) | کلید و پریز | 39/0/39 | 1 | 300,000 |  |
| 38 | پریز ارت | suggested | پریز برق لگرند ارت دار قرمز و سفید (33,000) | کلید و پریز | 135/0/204 | 1 | 317,000 |  |
| 39 | پروژکتور ۵۰ وات | suggested | پرژکتور ۵۰ وات بیلبوردی چینی (300,000) | پروژکتور و وال واشر | 209/87/1394 | 1 | 1,697,000 |  |
| 40 | پروژکتور ال ای دی ۱۰۰ وات | suggested | پروژکتور ال ای دی ای لایت ۱۰۰ وات کد IP66 (400,000) | پروژکتور و وال واشر | 17/5/131 | 1 | 3,143,000 |  |
| 41 | لامپ ال ای دی ۱۰ وات | suggested | لامپ ال ای دی 10 وات مدل کلاسیک رنگی برند دلتا پایه E27 رنگ قرمز کد DELTA-LAMP-LED-10W-E27 (49,000) | لامپ LED و کم مصرف | 31/26/934 | 1 | 160,000 |  |
| 42 | چراغ پنلی سقفی | suggested | پنل توکار 5 وات مدل بتا داتیس (37,950) | چراغ پنلی و سقفی | 2295/16/2370 | 1 | 1,260,000 | cheap10 nohead |
| 43 | پروژکتور خورشیدی | suggested | پرژکتورخورشیدی روشنایی لامپ خورشیدی (685,000) | چراغ و پروژکتور خورشیدی | 149/0/324 | 1 | 3,800,000 |  |
| 44 | گوشی سامسونگ A56 با قاب و گلس › گوشی سامسونگ A56 | suggested | گوشی سامسونگ A56 5G / حافظه 128 رم 8 گیگابایت (100,600,000) | گوشی موبایل | 3/28/814 | 1 | 116,800,000 |  |
| 45 | گوشی سامسونگ A56 با قاب و گلس › قاب | suggested | قاب شفاف شاین طرح دار آلبالو برجسته مناسب برای گوشی Samsung Galaxy A56 (245,000) | کیف و کاور گوشی | 27/414/2176 | 1 | 539,000 |  |
| 46 | گوشی سامسونگ A56 با قاب و گلس › گلس | suggested | گلس آنتی استاتیک سامسونگ A56 با جنس شیشه (130,000) | محافظ صفحه نمایش گوشی | 5/147/982 | 1 | 749,000 |  |
| 47 | گوشی آیفون ۱۳ | suggested | گوشی اپل دو سیم iPhone 13 (Not Active) / حافظه 128 گیگابایت (235,000,000) | گوشی موبایل | 2/266/814 | 1 | 235,000,000 |  |
| 48 | گوشی شیائومی ردمی نوت ۱۳ | suggested | گوشی شیائومی Redmi Note 13 4G / حافظه 512 رم 8 گیگابایت (122,900,000) | گوشی موبایل | 1/20/814 | 1 | 122,900,000 |  |
| 49 | گوشی سامسونگ ۲۵۶ گیگ | suggested | گوشی سامسونگ (ویتنام) A25 5G / حافظه 256 رم 8 گیگابایت (75,000,000) | گوشی موبایل | 33/22/814 | 1 | 148,000,000 |  |
| 50 | گوشی موبایل | suggested | گوشی نوکیا (بدون گارانتی) 2022 105 / حافظه 4 مگابایت (1,335,000) | گوشی موبایل | 681/0/814 | 1 | 57,000,000 | cheap10 |
| 51 | قاب آیفون ۱۳ | suggested | کاور طرح عروسکی مناسب برای گوشی موبایل اپل iPhone 13/14 (180,000) | کیف و کاور گوشی | 31/414/2176 | 1 | 694,000 | nohead |
| 52 | گلس سامسونگ A56 | suggested | گلس آنتی استاتیک سامسونگ A56 با جنس شیشه (130,000) | محافظ صفحه نمایش گوشی | 5/147/982 | 1 | 749,000 |  |
| 53 | محافظ صفحه آیفون ۱۵ | suggested | گلس آنتی استاتیک گوشی آیفون ۱۵ گرند (299,000) | محافظ صفحه نمایش گوشی | 8/147/982 | 1 | 748,000 |  |
| 54 | شارژر سامسونگ | suggested | شارژر سامسونگ مدل EP TA200 توان 15 وات دو پین (280,000) | شارژر گوشی | 174/107/722 | 1 | 2,388,000 |  |
| 55 | شارژر ۲۵ وات | suggested | شارژر سامسونگ مدل EP-TA800 توان 25 وات سه پین (350,000) | شارژر گوشی | 66/76/722 | 1 | 1,868,000 |  |
| 56 | کابل شارژ تایپ سی | suggested | کابل تایپ سی type-c ، مدل x17 سوپر فست 6 آمپر (76,000) | کابل و تبدیل Type C | 252/0/258 | 1 | 610,000 |  |
| 57 | هندزفری بلوتوثی | suggested | هندزفری بی سیم تک گوش HI-FI مدل M11 (271,000) | هدفون، هدست و هندزفری | 147/0/587 | 1 | 3,000,000 | cheap10 |
| 58 | هدفون | suggested | هدفون بی سیم سی بای مدل C2N (137,000) | هدفون، هدست و هندزفری | 793/0/1339 | 1 | 4,590,000 | cheap10 |
| 59 | ایرپاد | suggested | ایرپاد بی سیم سامسونگ مدل K30 (185,000) | هدفون، هدست و هندزفری | 84/0/1339 | 1 | 3,977,800 | cheap10 |
| 60 | پاوربانک ۲۰۰۰۰ | suggested | پاوربانک کینگ پاور مدل KPG-205 ظرفیت 20000 میلی آمپر (1,576,500) | پاوربانک و شارژر همراه | 206/73/755 | 1 | 5,209,000 |  |
| 61 | پاوربانک | suggested | پاوربانک وایرلس اپل ۱۰۰۰ میلی‌آمپر (890,000) | پاوربانک و شارژر همراه | 750/3/755 | 1 | 4,979,000 |  |
| 62 | ساعت هوشمند | suggested | ساعت هوشمند T10000 Ultra3 با بند سیلیکونی (1,108,800) | ساعت و مچ بند هوشمند | 429/0/462 | 1 | 6,945,000 |  |
| 63 | ساعت مچی مردانه | suggested | ساعت مردانه نایکی آنالوگ (800,000) | ساعت مچی عقربه‌ ای و دیجیتالی | 1209/1/1214 | 1 | 23,500,000 | cheap10 |
| 64 | اپل واچ | suggested | ساعت هوشمند T10000 Ultra3 با بند سیلیکونی (1,108,800) | ساعت و مچ بند هوشمند | 446/0/462 | 1 | 7,000,000 | nohead |
| 65 | لپ‌تاپ ایسوس | suggested | لپ تاپ ایسوس E410KA / 4GB RAM / 256GB SSD / Celeron N4500 (74,198,940) | لپ تاپ و نوت بوک | 134/4/505 | 1 | 278,919,470 |  |
| 66 | لپ تاپ لنوو | suggested | نوت‌بوک لنوو T450S سایز ۱۴ اینچ Core i5 رم ۸ گیگابایت (32,500,000) | لپ تاپ و نوت بوک | 133/4/505 | 1 | 243,000,000 |  |
| 67 | لپ تاپ | suggested | لپ تاپ HP مدلEliteBook 840 G1(I5(4u)/8/500/INTEL) (25,500,000) | لپ تاپ و نوت بوک | 479/0/505 | 1 | 317,998,940 | cheap10 |
| 68 | تلویزیون سامسونگ ۵۵ اینچ | suggested | تلویزیون هوشمند سامسونگ مدل U8000F سایز ۵۵ اینچ Ultra HD 4K (99,500,000) | تلویزیون | 13/5/358 | 1 | 142,000,000 |  |
| 69 | تلویزیون ال جی | suggested | 8050 UR سایز 55ال جی (85,500,000) | تلویزیون | 67/13/358 | 1 | 227,000,000 |  |
| 70 | تلویزیون | suggested | تلویزیون صنام مدل SLE-24M116 سایز ۲۴ اینچ (22,500,000) | تلویزیون | 357/0/358 | 1 | 172,000,000 |  |
| 71 | کفش ورزشی | suggested | کفش زنانه مدل m364 (979,800) | کفش کالج زنانه | 229/0/243 | 1 | 5,700,000 |  |
| 72 | کفش مردانه | suggested | کفش اداری مردانه ماهان از چرم (2,290,000) | کفش مجلسی و رسمی مردانه | 188/3/196 | 1 | 9,780,000 |  |
| 73 | کتانی نایکی | suggested | کتانی نایکی زنانه تمپو (1,280,000) | کتانی و کفش اسپرت | 153/649/865 | 1 | 3,390,000 |  |

#### Listings set aside by the plausibility rules (per item)

| # | item | other-kind title heads (count) | unit unclear |
|---|---|---|---|
| 1 | دوربین داهوا ۲ مگاپیکسل | #blanked×2 ضبط×1 اسپیکر×1 سیمکارت×1 پکیج×1 تصویری×1 پک×1 |  |
| 2 | دوربین داهوا ۲ مگاپیکسل | #blanked×2 ضبط×1 اسپیکر×1 سیمکارت×1 پکیج×1 تصویری×1 پک×1 |  |
| 3 | ضبط‌کننده ۴ کانال | کابل×1 با×1 فیش×1 باندل×1 |  |
| 4 | هارد ۲ ترابایت | باندل×1 پک×1 |  |
| 5 | آداپتور | شارژر×27 فیش×7 پاور×6 #blanked×2 تبدیل×1 سوکت×1 کلگی×1 قاب×1 شارژ×1 |  |
| 6 | دوربین مداربسته | #blanked×2 ضبط×1 اسپیکر×1 سیمکارت×1 پکیج×1 تصویری×1 پک×1 |  |
| 7 | دوربین هایک ویژن ۵ مگاپیکسل | #blanked×2 ضبط×1 اسپیکر×1 سیمکارت×1 پکیج×1 تصویری×1 پک×1 |  |
| 9 | دوربین دام AHD | #blanked×2 ضبط×1 اسپیکر×1 سیمکارت×1 پکیج×1 تصویری×1 پک×1 |  |
| 10 | دی وی آر ۸ کانال | کابل×1 با×1 فیش×1 باندل×1 |  |
| 11 | ان وی آر ۸ کانال | کابل×1 با×1 فیش×1 باندل×1 |  |
| 12 | ضبط کننده ۱۶ کانال | کابل×1 با×1 فیش×1 باندل×1 |  |
| 13 | هارد ۱ ترابایت | باندل×1 پک×1 |  |
| 14 | هارد بنفش ۴ ترابایت | باندل×1 پک×1 |  |
| 15 | آداپتور | شارژر×27 فیش×7 پاور×6 #blanked×2 تبدیل×1 سوکت×1 کلگی×1 قاب×1 شارژ×1 |  |
| 16 | آداپتور ۱۲ ولت ۲ آمپر | شارژر×27 فیش×7 پاور×6 #blanked×2 تبدیل×1 سوکت×1 کلگی×1 قاب×1 شارژ×1 |  |
| 17 | آداپتور ۱۲ ولت | شارژر×27 فیش×7 پاور×6 #blanked×2 تبدیل×1 سوکت×1 کلگی×1 قاب×1 شارژ×1 |  |
| 18 | منبع تغذیه ۱۲ ولت ۱۰ آمپر | اداپتور×34 اسلیم×4 ادابتور×3 شارژر×2 نری×1 برد×1 پاورسویچینگ×1 درایور×1 برددیپسی×1 بار×1 |  |
| 19 | سیم ۲.۵ [roll] | کلید×3 #blanked×2 قرقره×2 توزیع×2 هوایی×1 پریز×1 نوع×1 حشره×1 بلانک×1 کم×1 سینی×1 تسمه×1 چند×1 سفارش×1 ویژه×1 گالا×1 سفید×1 | 89 |
| 20 | سیم ۲.۵ [meter] | کلید×3 #blanked×2 قرقره×2 توزیع×2 هوایی×1 پریز×1 نوع×1 حشره×1 بلانک×1 کم×1 سینی×1 تسمه×1 چند×1 سفارش×1 ویژه×1 گالا×1 سفید×1 | 89 |
| 21 | سیم برق ۱.۵ افشان [roll] | کلید×3 #blanked×2 قرقره×2 توزیع×2 هوایی×1 پریز×1 نوع×1 حشره×1 بلانک×1 کم×1 سینی×1 تسمه×1 چند×1 سفارش×1 ویژه×1 گالا×1 سفید×1 | 89 |
| 22 | سیم برق ۱.۵ افشان [meter] | کلید×3 #blanked×2 قرقره×2 توزیع×2 هوایی×1 پریز×1 نوع×1 حشره×1 بلانک×1 کم×1 سینی×1 تسمه×1 چند×1 سفارش×1 ویژه×1 گالا×1 سفید×1 | 89 |
| 23 | سیم ۴ مفتولی [roll] | کلید×3 #blanked×2 قرقره×2 توزیع×2 هوایی×1 پریز×1 نوع×1 حشره×1 بلانک×1 کم×1 سینی×1 تسمه×1 چند×1 سفارش×1 ویژه×1 گالا×1 سفید×1 | 89 |
| 24 | سیم ۴ مفتولی [meter] | کلید×3 #blanked×2 قرقره×2 توزیع×2 هوایی×1 پریز×1 نوع×1 حشره×1 بلانک×1 کم×1 سینی×1 تسمه×1 چند×1 سفارش×1 ویژه×1 گالا×1 سفید×1 | 89 |
| 25 | کابل ۳ در ۲.۵ [roll] | کلید×3 #blanked×2 قرقره×2 توزیع×2 هوایی×1 پریز×1 نوع×1 حشره×1 بلانک×1 کم×1 سینی×1 تسمه×1 چند×1 سفارش×1 ویژه×1 گالا×1 سفید×1 | 89 |
| 26 | کابل ۳ در ۲.۵ [meter] | کلید×3 #blanked×2 قرقره×2 توزیع×2 هوایی×1 پریز×1 نوع×1 حشره×1 بلانک×1 کم×1 سینی×1 تسمه×1 چند×1 سفارش×1 ویژه×1 گالا×1 سفید×1 | 89 |
| 27 | سیم ۶ [roll] | کلید×3 #blanked×2 قرقره×2 توزیع×2 هوایی×1 پریز×1 نوع×1 حشره×1 بلانک×1 کم×1 سینی×1 تسمه×1 چند×1 سفارش×1 ویژه×1 گالا×1 سفید×1 | 89 |
| 28 | سیم ۶ [meter] | کلید×3 #blanked×2 قرقره×2 توزیع×2 هوایی×1 پریز×1 نوع×1 حشره×1 بلانک×1 کم×1 سینی×1 تسمه×1 چند×1 سفارش×1 ویژه×1 گالا×1 سفید×1 | 89 |
| 29 | سیم برق ۱۰۰ متر | کلید×3 #blanked×2 قرقره×2 توزیع×2 هوایی×1 پریز×1 نوع×1 حشره×1 بلانک×1 کم×1 سینی×1 تسمه×1 چند×1 سفارش×1 ویژه×1 گالا×1 سفید×1 | 89 |
| 30 | سیم برق ۲/۵ افشان ۵۰ متر [roll] | کلید×3 #blanked×2 قرقره×2 توزیع×2 هوایی×1 پریز×1 نوع×1 حشره×1 بلانک×1 کم×1 سینی×1 تسمه×1 چند×1 سفارش×1 ویژه×1 گالا×1 سفید×1 | 89 |
| 31 | کلید و پریز [roll] | محافظ×30 کادر×27 رابط×18 شاسی×9 راهی×9 مادگی×8 کیستون×6 فیس×5 انتن×5 نری×3 خانه×3 قاب×2 پورت×2 چندراهی×2 تایمر×2 ضامن×1 دسته×1 سرپیچ×1 کاور×1 کیلید×1 صفحه×1 تلفن×1 تبدیل×1 پروگرام×1 امرجنسی×1 پل×1 زنگ×1 ترموستات×1 کف×1 نر×1 فیوز×1 |  |
| 32 | سیم برق ۲/۵ افشان ۵۰ متر [meter] | کلید×3 #blanked×2 قرقره×2 توزیع×2 هوایی×1 پریز×1 نوع×1 حشره×1 بلانک×1 کم×1 سینی×1 تسمه×1 چند×1 سفارش×1 ویژه×1 گالا×1 سفید×1 | 89 |
| 33 | کلید و پریز [meter] | محافظ×30 کادر×27 رابط×18 شاسی×9 راهی×9 مادگی×8 کیستون×6 فیس×5 انتن×5 نری×3 خانه×3 قاب×2 پورت×2 چندراهی×2 تایمر×2 ضامن×1 دسته×1 سرپیچ×1 کاور×1 کیلید×1 صفحه×1 تلفن×1 تبدیل×1 پروگرام×1 امرجنسی×1 پل×1 زنگ×1 ترموستات×1 کف×1 نر×1 فیوز×1 |  |
| 34 | کلید و پریز | محافظ×30 کادر×27 رابط×18 شاسی×9 راهی×9 مادگی×8 کیستون×6 فیس×5 انتن×5 نری×3 خانه×3 قاب×2 پورت×2 چندراهی×2 تایمر×2 ضامن×1 دسته×1 سرپیچ×1 کاور×1 کیلید×1 صفحه×1 تلفن×1 تبدیل×1 پروگرام×1 امرجنسی×1 پل×1 زنگ×1 ترموستات×1 کف×1 نر×1 فیوز×1 |  |
| 36 | پریز برق | کلید×433 محافظ×30 کادر×27 فیش×27 شاخه×27 دوشاخه×20 رابط×18 سوکت×17 مکانیزم×14 شاسی×9 راهی×9 مادگی×8 کیستون×6 فیس×5 انتن×5 دیمر×3 نری×3 خانه×3 قاب×2 پورت×2 چندراهی×2 تایمر×2 ضامن×1 دسته×1 سرپیچ×1 کاور×1 کیلید×1 صفحه×1 تلفن×1 تبدیل×1 پروگرام×1 امرجنسی×1 پل×1 زنگ×1 ترموستات×1 کف×1 نر×1 فیوز×1 |  |
| 38 | پریز ارت | کلید×24 رابط×18 راهی×7 دوشاخه×6 محافظ×4 مکانیزم×3 خانه×3 مادگی×2 شاخه×1 چندراهی×1 |  |
| 39 | پروژکتور ۵۰ وات | وال×126 والواشر×15 چمنی×5 جت×3 نور×3 لوگو×3 والواش×2 قاب×2 ویدئو×2 کابل×1 محصول×1 فریم×1 های×1 پار×1 |  |
| 40 | پروژکتور ال ای دی ۱۰۰ وات | وال×23 |  |
| 41 | لامپ ال ای دی ۱۰ وات | چراغ×36 مهتابی×7 سیلیکون×5 جعبه×4 #blanked×3 بدنه×3 پاور×2 پک×2 سیم×1 پایه×1 پار×1 براکت×1 پرده×1 مووینگ×1 قرمز×1 |  |
| 42 | چراغ پنلی سقفی | هالوژن×28 #blanked×16 سنسور×4 پایه×4 قاب×3 تبدیل×3 فریم×3 رفلکتور×2 مبدل×2 چشمی×1 محصول×1 براکت×1 ال×1 لامپ×1 اویز×1 چراغهای×1 لوستر×1 اتولایت×1 فن×1 |  |
| 43 | پروژکتور خورشیدی | چراغ×149 لامپ×13 فانوس×2 پکیج×2 سیستم×2 بسته×1 دکوراتیو×1 روشنایی×1 پنل×1 جعبه×1 پنکه×1 اینورتر×1 |  |
| 44 | گوشی سامسونگ A56 | باندل×2 رام×1 نرمال×1 بدون×1 ظرفیت×1 |  |
| 45 | قاب | کیف×179 در×2 محافظ×1 مک×1 پاکت×1 قای×1 جاکارتی×1 جا×1 اسپیکر×1 پک×1 |  |
| 46 | گلس | تاچ×1 نانو×1 |  |
| 47 | گوشی آیفون ۱۳ | باندل×2 رام×1 نرمال×1 بدون×1 ظرفیت×1 |  |
| 48 | گوشی شیائومی ردمی نوت ۱۳ | باندل×2 رام×1 نرمال×1 بدون×1 ظرفیت×1 |  |
| 49 | گوشی سامسونگ ۲۵۶ گیگ | باندل×2 رام×1 نرمال×1 بدون×1 ظرفیت×1 |  |
| 50 | گوشی موبایل | باندل×2 رام×1 نرمال×1 بدون×1 ظرفیت×1 |  |
| 51 | قاب آیفون ۱۳ | کیف×179 در×2 محافظ×1 مک×1 پاکت×1 قای×1 جاکارتی×1 جا×1 اسپیکر×1 پک×1 |  |
| 52 | گلس سامسونگ A56 | تاچ×1 نانو×1 |  |
| 53 | محافظ صفحه آیفون ۱۵ | تاچ×1 نانو×1 |  |
| 54 | شارژر سامسونگ | پک×11 شارژ×3 ادابتور×2 ست×2 سپراتور×2 داک×1 کیت×1 #blanked×1 اسپیکر×1 سبد×1 پاوربانک×1 بسته×1 |  |
| 55 | شارژر ۲۵ وات | پک×11 شارژ×3 ادابتور×2 ست×2 سپراتور×2 #blanked×1 داک×1 کیت×1 اسپیکر×1 سبد×1 پاوربانک×1 بسته×1 |  |
| 56 | کابل شارژ تایپ سی | مبدل×3 کارتن×3 |  |
| 57 | هندزفری بلوتوثی | هدفون×406 ایرپاد×13 هدست×13 کارتن×5 |  |
| 58 | هدفون | هندزفری×359 هدست×95 ایرپاد×64 کارتن×6 ایرفون×5 هنذفری×3 هندفری×2 ایربادز×2 ایردپاد×1 عینک×1 مشکی×1 اداپتور×1 ایرباد×1 |  |
| 59 | ایرپاد | هدفون×777 هندزفری×359 هدست×95 کارتن×6 ایرفون×5 هنذفری×3 هندفری×2 عینک×1 مشکی×1 اداپتور×1 |  |
| 60 | پاوربانک ۲۰۰۰۰ | #blanked×3 باتری×1 اسپیکر×1 |  |
| 61 | پاوربانک | #blanked×3 باتری×1 اسپیکر×1 |  |
| 62 | ساعت هوشمند | مچ×10 دستبند×7 کاور×1 پک×1 هولدر×1 شارژر×1 نواری×1 کارکرده×1 |  |
| 63 | ساعت مچی مردانه | ست×4 #blanked×1 |  |
| 64 | اپل واچ | کاور×1 پک×1 هولدر×1 شارژر×1 نواری×1 کارکرده×1 |  |
| 68 | تلویزیون سامسونگ ۵۵ اینچ | ال×1 |  |
| 70 | تلویزیون | ال×1 |  |
| 71 | کفش ورزشی | صندل×4 ️هوالرزاق×3 بوت×2 سنسور×2 عروسکی×1 کتونی×1 ساتن×1 |  |
| 72 | کفش مردانه | #blanked×3 کد×3 ونس×2 |  |
| 73 | کتانی نایکی | #blanked×15 ️هوالرزاق×4 کد×1 کیفیت×1 بوت×1 مردانه×1 کالج×1 سنسور×1 کلکسیون×1 نو×1 |  |
