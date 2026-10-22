# Torob Hackathon — UX Proposal v3 (streamlined, Persian-first)

Status: revision for approval. **Plan mode: no code, no framework or hosting decisions.**
Tags: **[OBS]** measured in the dataset · **[DEC]** agreed decision · **[REC]** my recommendation · **[ASM]** unverified assumption.
Snapshot of the data: 13 Oct 2026 (= ۲۱ مهر ۱۴۰۵). Deadline: 23 Oct 2026, 23:50 Tehran.
Developer-facing text (this document, code, README) is English. **Every user-facing string below is Persian and is meant to be used as the real copy.**

---

## 0. What changed, and what I'm challenging

| Your point | v2 | v3 |
|---|---|---|
| 1. Friction | Confirm-list screen, then a mandatory model picker per item | **No confirm screen and no mandatory picking.** Typing leads straight to the working screen. The app asks at most one short question per item, and only when the answer changes the result (section 3). |
| 2. Auto-selection | "Most sellers" pre-selected | **Removed.** Suitability comes first: stated requirements, compatibility, budget. Seller count is only a tie-breaker for plan feasibility between equally suitable products, and is never presented as quality. |
| 3. Phone numbers | Shown, copy-only | **Removed everywhere.** Shop cards show name, mall, floor/unit, address and hours. |
| 4. Persistence | P1 | **P0.** Auto-save on the device, a "continue" card on Home, no account. |
| 5. Visit time | Day only | **Day and optional time window**, via one optional chip, default "هر زمان". |
| 6. Feasibility | Plans assumed complete | **Item states** (exact / alternative / needs your choice / not found / price unknown). Incomplete plans never rank as cheapest. |
| 7. IA | 3 tabs, 9 screens | **2 screens + a few sheets, no tab bar, no Data tab.** |
| 8. Plans | Always three cards | **One recommended plan by default.** Alternatives appear only when they differ meaningfully. |
| 9. Persian | RTL layout, partly English wireframes | **Persian-first throughout, with real copy** (section 8). |
| Reports | Mixed into totals | **User reports are labelled "گزارش شما" and stay separate from dataset facts.** They are never counted as verified. |

Assumptions I'm challenging, and the verdict:
- *"Three plan cards are the signature feature."* → **Rejected.** [OBS] 83% of products have one seller, so most real plans have a single feasible choice. Forcing three cards would be fabricated variety. The signature is the plan itself: stops, exact products, honest status.
- *"A separate list-confirmation step builds trust."* → **Rejected.** It is the biggest friction source. Trust comes from seeing the interpretation inline, editable in place.
- *"Model picking is a necessary step."* → **Partly rejected.** Choosing is only needed when the requirement is loose and the candidates differ a lot. [OBS] This is often true (see below), so the question must be fast and specific, not a catalogue browse.
- *"A Data tab is needed for transparency."* → **Rejected.** Disclosures belong where decisions happen, plus one "درباره‌ی داده‌ها" sheet.

---

## 1. First-time user lens: the minimum-effort path

A tradesperson types one sentence and wants to know **where to go and what to carry**. The target path:

1. Open the app. The only large element is a text box. (0 taps)
2. Type or tap an example. (1 action)
3. See a working screen with the list understood, and for each item either an exact product or a 1–2 tap question. (about 3 taps total in the worst case, 0 when the request names exact models)
4. See the plan: stops with exact products, prices, hours. (0 taps)
5. Optionally set the visit time. Tap «در بازارم» when there. (1 tap)

Everything else (alternatives, swapping, assistant, details) is reachable but never in the way.

---

## 2. Decision ledger (v3)

| # | Decision | Status |
|---|---|---|
| D1 | Plan at home, then use the same plan as an on-site checklist | [DEC] |
| D2 | One smart input + contextual assistant sheet; no chat thread | [DEC] |
| D3 | Hero user: project shopper with 2–5 items | [DEC] |
| D5 | Location optional, never required | [DEC] |
| D8 | One hosted LLM with deterministic fallback; 2–3 people | [DEC] |
| D9 | Show-to-seller card and report-back | [DEC, you approved] |
| D4′ | **One recommended plan + alternatives only when meaningfully different** (replaces always-3 cards) | [REC] |
| D6′ | **No phone numbers anywhere** (replaces D6/D7) | [DEC, your request] |
| D10 | **Progressive resolution** of items (section 3) | [REC] |
| D11 | **Persistence P0**: auto-save on device, resume card, optional share link | [DEC, your request] |
| D12 | **Visit day + optional time window** | [DEC, your request] |
| D13 | **User reports are local to the user's device and never mixed into dataset facts** | [REC] |
| D14 | **2 screens + sheets, no tab bar** | [REC] |

---

## 3. The core model: requirements, resolution, and feasibility

### 3.1 Why model choice cannot be fully automatic (data)
[OBS] Candidate pools are wide:
| Request | Priced candidates | Price spread (p10 → p90 of each model's cheapest listing) |
|---|---|---|
| دوربین داهوا ۲ مگاپیکسل | 154 | ۱٫۹ → ۸٫۵ میلیون |
| ضبط‌کننده ۴ کانال | 216 | ۶٫۵ → ۳۳ میلیون |
| سیم افشان ۲٫۵ | 340 | ۹۶ هزار → ۱۹ میلیون (واحد فروش متفاوت: متری / حلقه) |
| کاور برای A56 | 30 | ۲۸۰ هزار → ۲ میلیون |

- [OBS] Median seller count per model is 1. Choosing among models decides whether a plan even exists.
- [OBS] Only about half of camera titles carry a megapixel token and the spec fields are sparse, so requirements must be read from titles (LLM-assisted), and may be wrong or absent.
- [INF] "Cheapest in the pool" would pick junk or the wrong unit (a per-metre price against a 100 m roll). "Most sellers" is arbitrary. Both are rejected as automatic defaults.

### 3.2 Item states (the vocabulary the whole UI uses)

| State | Persian label | Meaning | Counted in total? |
|---|---|---|---|
| Exact | «دقیقاً همین» | Matches everything the user stated, or an exact model code | Yes |
| Alternative | «جایگزین» + what differs | Close but different in something stated (e.g., 5 مگاپیکسل instead of 2) | Yes, marked |
| Needs a choice | «نیاز به انتخاب شما» | Requirement too loose; candidates differ a lot | **No** |
| Not found | «پیدا نشد» | No listing meets it | No |
| Price unknown | «قیمت ثبت نشده» | Found, but no usable price | No, and the total says so |

### 3.3 What is automatic and what asks the user

**Automatic (never asks):**
- Normalising the text (ی/ک, digits, ZWNJ), splitting it into items, quantities, category mapping.
- Exact model codes (e.g., `XVR1B04-I`) → state «دقیقاً همین».
- Inheriting context inside the list: a case or glass item takes the phone model from the phone item. Shown as a visible chip and editable.
- Finding the sellers of a chosen product, grouping stops by mall, checking hours, merging identical plans, hiding implausible prices.
- Today as the default day.

**Asks (at most one short question per item, always skippable):**
Triggered only when the candidate pool is heterogeneous (several brands, or price spread above about 3×) and the user did not constrain it. Question order: (1) the most discriminating attribute, usually brand or a key spec; (2) budget band built from the real pool quartiles. Each answer is one tap on a chip.

**Explicit consent to default.** The chip «فرقی نمی‌کند» resolves the item by the visible rule «ارزان‌ترین گزینهٔ مناسب»: the cheapest listing that matches the stated requirements, with a clearly priced and unit-consistent product (not a per-metre vs per-roll mismatch). The chosen product is always shown, with «تغییر» next to it. A single bar button «برای همه‌ی موارد: فرقی نمی‌کند» resolves all open items at once.

**Never automatic:** choosing a brand or budget for the user; ranking by seller count; calling a plan «ارزان‌ترین» while any item is unresolved.

---

## 4. Information architecture (simplified)

```
Header (no tab bar):  [نام برنامه]            [ادامه‌ی برنامه ▾]   [ⓘ]

Screen 1: خانه            describe the need · examples · resume
Screen 2: برنامه          ONE working screen: items → plan → stops → checklist
   Sheets over Screen 2:
     • گزینه‌ها (item options / alternatives / swap seller)
     • زمان رفتن (day & time)
     • نمایش به فروشنده (show-to-seller + report)
     • تغییر برنامه (assistant)
     • درباره‌ی داده‌ها (disclosures)
```
- Two screens total. Screen 2 changes **mode**, not screen: «برنامه‌ریزی» ↔ «در بازارم» (checklist) via a segmented control at the top.
- The «ادامه‌ی برنامه» menu in the header lists saved plans (see 6.8), so persistence is reachable from anywhere.
- Disclosures live in three places only: a dismissible line on Home, a permanent one-line note under the plan total, and the «درباره‌ی داده‌ها» sheet behind ⓘ.

Comparison with v2: 9 screen types → 2 screens + 5 sheets; the Data tab and bottom nav are gone.

---

## 5. How the experience adapts: four request types

### A. Simple search («دوربین داهوا ۲ مگاپیکسل»)
Same working screen with one item. Because there is one item, the "plan" is the **list of sellers** (price, listing title, warranty, mall/floor, hours). No stops grouping, no plan alternatives.
- Specific enough → the item is «دقیقاً همین» or shows 2–3 closely related models to pick from; the seller list appears at once.
- Loose («دوربین مداربسته») → one question: brand chips + budget chips, before the seller list.
- 0 taps to a useful result when the request is specific; 1–2 taps when loose.

### B. Multi-item list («۴ دوربین داهوا ۲ مگاپیکسل، ضبط‌کننده ۴ کانال، هارد ۲ ترابایت و آداپتور»)
- Items parsed, resolved inline. Items with exact info are done; loose ones show chips.
- The plan appears as soon as at least one item is resolved, labelled «ناقص» until all are.
- Hours/day/time and swaps live in the plan, not in a separate step.

### C. Ambiguous request («سیم برق برای اتاق»)
The app does not guess a product. It shows the item as «نیاز به انتخاب شما» with the real range, then asks in plain words:
- «چه سیمی؟» → [سیم افشان ۱٫۵] [سیم افشان ۲٫۵] [کابل ۳×۲٫۵] [مطمئن نیستم]
- «چطور می‌خری؟» → [حلقهٔ ۱۰۰ متری] [متری]
«مطمئن نیستم» opens the assistant sheet with a short Persian explanation grounded in the dataset's own titles (no invented advice) and chips to choose from.

### D. Unsuccessful search («لپ‌تاپ ایسوس»)
- Honest, specific empty state: «لپ‌تاپ در فهرست این بازار پیدا نشد.» + what the data does cover + real nearby categories as chips. The user can still keep the item in the list marked «پیدا نشد», so the plan for the other items continues.
- If the category exists but no listing matches (e.g., a specific glass brand): show the closest items as «جایگزین» with the difference stated.

---

## 6. Screens and sheets (with Persian copy)

The app name is a placeholder: «همراه‌بازار». All numbers below use Persian digits; amounts are in toman.

### 6.1 Screen 1 — خانه
```
┌────────────────────────────────────┐
│ همراه‌بازار           [ادامه‌ی برنامه]  ⓘ │
│                                    │
│ برای خریدت چی لازم داری؟             │
│ ┌────────────────────────────────┐ │
│ │ مثلاً: ۴ دوربین داهوا ۲ مگاپیکسل،  │ │
│ │ ضبط‌کننده ۴ کانال و هارد ۲ ترابایت │ │
│ └───────────────────────[ برو ← ]┘ │
│                                    │
│ نمونه‌ها                            │
│ [نصب دوربین مداربسته] [برق‌کشی اتاق] │
│ [گوشی و کاور و گلس]                 │
│                                    │
│ ادامه‌ی برنامه‌ی قبلی                │
│ ┌────────────────────────────────┐ │
│ │ دوربین مداربسته ۴ تایی           │ │
│ │ ۳ از ۵ مورد آماده · دیروز        │ │
│ └────────────────────────────────┘ │
│                                    │
│ فهرست قیمت‌ها مربوط به ۲۱ مهر ۱۴۰۵ و │
│ محدودهٔ فردوسی، شیخ‌هادی و بهارستان است.│
└────────────────────────────────────┘
```
- First run: no carousel. The examples teach the product; tapping an example only fills the text box (editable) and submits it.
- Typing shows live suggestions of real categories and models (fallback path if the AI is unavailable).
- The resume card only shows when a saved plan exists.
- Empty-input hint: «یک یا چند مورد را بنویس؛ هر کدام را با ویرگول یا «و» جدا کن.»

### 6.2 Screen 2 — برنامه (the working screen), planning mode
```
┌────────────────────────────────────┐
│  [برنامه‌ریزی | در بازارم]       →   │
│ پروژهٔ دوربین مداربسته              │  (auto-named, editable)
│ ✓ ذخیره شد روی همین گوشی             │
│ [ کی می‌روی؟ هر زمان ▾ ]            │
│                                    │
│ فهرست خرید                          │
│ ┌ ✓ ۴ دوربین داهوا ۲ مگاپیکسل ─────┐ │
│ │ دقیقاً همین · HAC-HDW1200CLQP    │ │
│ │ از ۲٫۵ میلیون · ۲۱ فروشنده  [تغییر]│ │
│ └──────────────────────────────────┘ │
│ ┌ ؟ ضبط‌کننده ۴ کانال ──────────────┐ │
│ │ نیاز به انتخاب شما               │ │
│ │ ۲۱۶ مدل، از ۶٫۵ تا ۳۳ میلیون      │ │
│ │ برند: [داهوا] [هایک‌ویژن] [همه]    │ │
│ │ بودجه: [تا ۸ م] [۸ تا ۱۴ م] [بیشتر]│ │
│ │ [فرقی نمی‌کند، ارزان‌ترین مناسب]   │ │
│ └──────────────────────────────────┘ │
│ ┌ ✓ هارد ۲ ترابایت ... ────────────┐ │
│ [ + مورد دیگر ]                     │
│                                    │
│ برنامه — ناقص                       │
│ ۱ مورد منتظر انتخاب شماست؛ جمع زیر   │
│ بدون آن محاسبه شده است.              │
│ ...                                │
└────────────────────────────────────┘
```
- The list is compact: each item is one card with state, product (if known), price range and seller count. Chips appear only for items that need them.
- The list is above the plan on small screens and sticky-collapsible, so the plan does not push the list out of reach; a «همه‌ی موارد: فرقی نمی‌کند» bar shows only while items are open.
- The state glyph is always paired with a text label (never colour alone).

#### The plan block
```
 برنامهٔ پیشنهادی                     ۱۸٫۴ میلیون تومان (بدون ۱ مورد)
 ۳ توقف · همه در فاصلهٔ هوایی حدود ۲۰۰ متر
 «ارزان‌ترین گزینهٔ کامل، و فقط ۳٪ بالاتر از ارزان‌ترین برنامه با توقف بیشتر.»

 ۱  پاساژ علاءالدین · طبقهٔ ۶ · واحد ۶۲۲
    مغازهٔ «فرورا رویس»  ·  ساعت کار: امروز ۱۰ تا ۱۹
    ┌ ۴ × دوربین داهوا HAC-HDW1200CLQP
    │ «عنوان آگهی فروشنده…»
    │ ۳٫۲ میلیون هر عدد · گارانتی ۱۸ ماهه شرکتی
    │ آخرین تغییر قیمت: ۲۰ مهر
    │ [نمایش به فروشنده] [تغییر]
    └
    ↓ حدود ۹۰ متر تا توقف بعدی (خط مستقیم)
 ۲  پاساژ چارسو · طبقهٔ ۲ …

 قیمت‌ها از فهرست ۲۱ مهر است؛ موجودی تأیید نشده.   [درباره‌ی داده‌ها]
```
- Stop order is explained once: «ترتیب پیشنهادی بر اساس نزدیکی است، نه مسیر پیاده.»
- Each stop's full original address is one tap away (so floor/unit parsing errors are visible, not hidden).
- Price-change date is shown identically on every row: no colour, no ordering, no warnings by age.

### 6.3 Plan alternatives (only when meaningful)

A plan is shown as an alternative only if it differs from the recommended one by at least one stop **or** at least about 8% of the total, and is complete. Otherwise nothing is shown. When alternatives exist they appear as a plain sentence with a switch, not as three cards:

```
 گزینه‌های دیگر
 ◯ ارزان‌تر: ۱۷٫۱ میلیون، اما یک توقف بیشتر (پاساژ اتحادیه)
 ◯ نزدیک‌تر: همه در یک پاساژ، ۸۰۰ هزار تومان بیشتر
```
- Wording states the trade-off in toman, stops and place; no scores.
- If only one plan exists: «برای این فهرست فقط یک ترکیب ممکن است؛ چون {مورد} فقط یک فروشنده دارد.»
- **Default plan rule (simple and stated):** the cheapest complete plan, unless another complete plan is within about 5% of its price and has fewer stops. The sentence under the plan title explains whichever applied.
- Plans that are incomplete are never offered as «ارزان‌تر»; they are labelled «ناقص» and shown after the complete ones, or only as the single available plan.
- A single-shop line appears only when one shop carries every item: «همه‌چیز از یک مغازه: …».

### 6.4 Sheet — زمان رفتن
```
 کی می‌روی؟  (اختیاری)
 روز:   [امروز] [فردا] [انتخاب روز]
 ساعت:  [هر زمان] [صبح] [ظهر] [عصر] [ساعت دقیق…]
 «بیشتر مغازه‌ها تا ۱۹ باز هستند و جمعه‌ها فقط حدود ۱۹٪ مغازه‌های دارای ساعت کاری باز هستند.»
 [اعمال]
```
- Default «هر زمان» changes nothing. When a day/time is set, each stop shows «در این زمان باز است» / «در این زمان بسته است» / «ساعت کاری ثبت نشده».
- [OBS] backing for the hint: Saturday 13:00 → 91% of shops with hours are open; 19:30 → 30%; 21:00 → 8%; Friday 13:00 → 19%.
- Shops without hours (about 31%) are never treated as closed.
- If a chosen stop is closed at the chosen time, the stop shows a notice and the action «جایگزین باز پیدا کن», which recomputes only that item.

### 6.5 Sheet — گزینه‌ها (item options / swap seller)
Opened by «تغییر» on an item. Two tabs inside the sheet:
- «مدل‌های مشابه» — models that satisfy the requirement, sorted by price with the difference from the current choice («۵ مگاپیکسل، ۱٫۲ میلیون بیشتر»). Each row has brand, title, spec snippets from the title, price range, seller count.
- «فروشنده‌ها» — all sellers of the current product: listing title (as listed), price, warranty, mall/floor, hours (if a time is set), distance to the other stops.
A product with a single seller shows «فقط یک فروشنده دارد» rather than an empty comparison.

### 6.6 Sheet — نمایش به فروشنده
```
 دوربین مداربسته داهوا مدل HAC-HDW1200CLQP        (title as listed)
 تعداد: ۴          قیمت ثبت‌شده: ۳٬۲۰۰٬۰۰۰ تومان
 آخرین تغییر قیمت در فهرست: ۲۰ مهر ۱۴۰۵
 مغازه: فرورا رویس · پاساژ علاءالدین، طبقهٔ ۶، واحد ۶۲۲
 «این قیمت و موجودی از روی فهرست ثبت‌شده است و ممکن است تغییر کرده باشد. لطفاً تأیید کنید.»

 [ موجود است ]   [ موجود نیست ]   [ قیمت فرق دارد ]
```
- Large, readable text, meant to be shown or read aloud.
- «قیمت فرق دارد» asks for the new price with a numeric input (LTR digits, Persian display).

### 6.7 Mode — در بازارم (checklist) and user reports

Same screen, rows become large checkable items; the current stop is expanded.
- Per item: «خریدم» (optional actual price), «موجود نیست», «قیمت فرق دارد».
- **Dataset vs user information is visibly separate:**
  - Dataset facts keep their normal style: «قیمت فهرست: ۳٫۲ میلیون · تغییر ۲۰ مهر».
  - User reports use a distinct outlined badge and wording: «گزارش شما · امروز ۱۱:۲۰: موجود نیست» or «گزارش شما: ۳٫۴ میلیون».
  - Totals are labelled: «جمع طبق فهرست ۱۸٫۴ میلیون» and, only when reports exist, «جمع با گزارش‌های شما ۱۸٫۹ میلیون».
  - Reports are stored on this device only, belong to this plan, and are never presented as shared or verified. Reports never alter the dataset price shown to anyone else.
- «موجود نیست» or «قیمت فرق دارد» immediately offers (inside the same screen, as a sheet) the follow-up options: the same product at another seller near this stop, then similar models, with the difference stated. The AI may phrase the explanation; the engine chooses the candidates.
  Example reason line: «همین مدل در پاساژ چارسو، حدود ۱۱۰ متر آن‌طرف‌تر، ثبت شده است.»

### 6.8 Persistence (P0)
- Every change autosaves on this device: items, answers, chosen day/time, mode, checked items, user reports. No account, no prompt. Indicator: «✓ ذخیره شد روی همین گوشی».
- Home shows «ادامه‌ی برنامه‌ی قبلی»; the header menu «ادامه‌ی برنامه» lists up to about 5 recent plans, each with name, progress and last-used day.
- Plan actions in «⋯»: «تغییر نام»، «کپی پیوند برنامه»، «شروع برنامهٔ تازه»، «حذف».
- **Share link (P1, strongly useful):** «کپی پیوند» lets a user move a plan from a desktop to their phone with no account. The link carries only the plan's references; opening it on a device with an old snapshot shows the same snapshot date.
- If saved data cannot be read (private browsing), a quiet notice says: «ذخیره‌سازی در این مرورگر در دسترس نیست؛ برای نگه‌داشتن برنامه پیوند را کپی کن.»

### 6.9 Sheet — تغییر برنامه (assistant)
```
 چه چیزی را عوض کنم؟
 [ارزان‌تر] [نزدیک‌تر به هم] [کمتر توقف] [فقط مغازه‌های باز] [بدون این مغازه]
 [__ مثلاً: به‌جای داهوا هایک‌ویژن بذار __________ ➤]
```
- Chips first, free text second. Result = a highlighted diff on the plan with a one-line Persian reason and «برگرداندن».
- The assistant answers in natural Persian, only from real fields. If it can't comply: «با این فهرست امکانش نیست؛ چون …» plus the closest possible action.
- No transcript is kept: only the last change is shown, and Undo restores the previous state.

### 6.10 Sheet — درباره‌ی داده‌ها (via ⓘ)
Short Persian text, five bullets:
1. «قیمت‌ها از فهرست مغازه‌ها در ۲۱ مهر ۱۴۰۵ گرفته شده‌اند و ممکن است عوض شده باشند.»
2. «فهرست بودن یک کالا یعنی مغازه آن را ثبت کرده است؛ نه اینکه همین حالا موجود باشد.»
3. «نام مغازه‌ها در این نسخهٔ آزمایشی ساختگی است؛ آدرس و موقعیت واقعی است.»
4. «حدود ۱۰٪ مغازه‌های تهران و محدودهٔ فردوسی، شیخ‌هادی و بهارستان را پوشش می‌دهیم.»
5. «گزارش‌های شما فقط روی همین دستگاه می‌مانند و جزو داده‌ی رسمی نیستند.»
Plus counts (۶٬۴۷۶ مغازه · ۲۲۵٬۹۰۳ کالا) and a short «دستیار چه می‌کند؟» line: it reads your text and explains choices; it doesn't invent products, prices or confirmations.

---

## 7. Edge cases and failure states (Persian copy)

| Situation | Experience |
|---|---|
| AI unavailable / slow | Quiet line «جستجوی ساده فعال شد؛ مورد را از فهرست زیر انتخاب کن.» with keyword suggestions. The app stays fully usable. |
| Not in the data (laptop) | «لپ‌تاپ در فهرست این بازار پیدا نشد.» + «این نسخه بیشتر شامل برق و روشنایی، دوربین، موبایل و لوازم جانبی است.» + real category chips. The item stays in the list as «پیدا نشد». |
| Category exists, nothing matches the requirement | «موردی دقیقاً مطابق خواستهٔ تو نبود. نزدیک‌ترین‌ها:» with each difference stated; they are «جایگزین», not «دقیقاً همین». |
| Only one seller | «فقط یک فروشنده دارد»; no comparison language. |
| Price missing/implausible | «قیمت ثبت نشده»; excluded from totals; the total says «بدون ۲ مورد». Implausible prices are hidden. |
| Unit mismatch (per metre / per roll) | The unit is shown on the row («حلقهٔ ۱۰۰ متری» / «قیمت هر متر») and never compared across units. |
| Incomplete plan | Header «ناقص» + «چه چیزی کم است؟» list; never ranked as cheapest. |
| No hours | «ساعت کاری ثبت نشده» (neutral). |
| Closed at the chosen time | Stop notice + «جایگزین باز پیدا کن». |
| Shop in the dataset without any listing | Never appears as a seller. P2: shown under sparse categories as «مغازه‌هایی که این دسته را اعلام کرده‌اند (بدون فهرست قیمت)». |
| User reports "نبود" | Item switches to «گزارش شما: موجود نیست» (distinct style) and opens the replan sheet. Undo is always available. |
| User changes mind | Every card editable; answers persist; «برگرداندن» after AI edits. |
| Old price date | A date only, same style on every row. |
| Nothing saved / first visit | Home shows no resume card. |

---

## 8. Persian-first and RTL requirements (whole product)

**Language and content**
- 100% of user-facing text is Persian: navigation, buttons, headings, placeholders, toasts, loading texts, error pages (404/500/offline), empty states, onboarding hints, the page `<title>`, share text, `aria-label`/alt text, the link-preview text, and every AI response. `lang="fa"`, `dir="rtl"` on the root document.
- The AI is instructed in Persian and returns natural Persian in a consistent, friendly-but-direct tone (به‌صورت «تو» یا «شما»? — **[REC] «تو»**, warm and short; confirm in the copy pass). Numbers, prices and dates it writes come from data fields, not from model text.
- Developer docs and code stay in English; the README gets a short Persian summary for judges.

**Typography and layout**
- A Persian-first typeface (Vazirmatn or similar) at 16 px minimum, line height 1.6–1.7, heavier weight for amounts. ZWNJ (نیم‌فاصله) is respected in copy.
- Logical CSS (inline-start/end), directional icons mirrored, back arrow points right, progress fills right-to-left. Clocks and media icons aren't mirrored.
- Bottom sheets, steppers and chips lay out right-to-left; the primary action sits at the bottom, within thumb reach.

**Mixed Persian/Latin**
- Model codes and English brand fragments (e.g., `HAC-HDW1200CLQP`, `DH-XVR1B04-I`) are isolated (bidi isolation, LTR) so punctuation and digits never reorder. Product titles are rendered as received, wrapped per run.
- Search input normalises Arabic ي/ك to ی/ک, Arabic/Latin digits to a common form, and handles ZWNJ variants. [OBS] The data mixes Latin (309k) and Persian (32k) digits plus a few Arabic forms.

**Numbers, money, dates**
- Persian digits everywhere in the UI. Thousands separator «٬», decimal «٫».
- Prices in toman, compact in lists («۳٫۲ میلیون تومان»), exact on tap («۳٬۲۰۰٬۰۰۰ تومان»).
- Dates in the Jalali calendar with Persian month names («۲۱ مهر ۱۴۰۵»); weekdays start from شنبه; time in 24-hour format («۱۹:۳۰»).
- Numeric inputs accept Persian or Latin digits and normalise.

**Testing rule:** a Persian reviewer walks every sheet and error state in RTL on a real phone before submission.

---

## 9. Priorities (revised)

**P0 (the demo cannot succeed without these)**
1. Home with the smart input, examples and resume card.
2. Working screen with inline item states, 1-tap questions, and «فرقی نمی‌کند».
3. Plan block with stops grouped by mall/floor, exact products, hours for the chosen day/time, and honest incomplete-plan handling.
4. Day + optional time sheet.
5. Show-to-seller sheet with report-back, clearly labelled user reports.
6. Replan after «موجود نیست»/«قیمت فرق دارد».
7. Persistence: autosave, resume card, plan menu.
8. «درباره‌ی داده‌ها» sheet and the permanent one-line data note.
9. Persian-first RTL implementation and the AI fallback.

**P1:** plan alternatives sentences, share link, assistant free text, swap-seller tab, optional location line, relative-position sketch, brand/budget chips polish.
**P2:** map, shops-without-listings list, dark theme, multiple saved plans management beyond the recent list.
**Excluded:** phone numbers, reviews, ratings, seller quality scores, real routing, walking time, live stock, accounts, payments, voice and image input.

**Cuts that keep it achievable:** one working screen reused across modes; sheets are simple; no tab bar; no separate onboarding; no third-party map.

---

## 10. Demo flow (five minutes, all Persian)

1. **۰:۰۰ مشکل (۳۰ ثانیه):** a wasted trip to a closed or out-of-stock shop.
2. **۰:۳۰ ورودی هوشمند:** the CCTV project sentence → the working screen appears.
3. **۱:۰۰ سؤال کوتاه:** the recorder needs a choice → two taps (brand, budget). The cameras and the hard drive resolve with no taps because the request names them.
4. **۱:۳۰ برنامه:** stops by mall, exact products, one sentence of reasoning, honest «ناقص» → «کامل» change.
5. **۲:۱۵ زمان رفتن:** switch to Friday / evening and watch stops flag closed; replace one with an open alternative.
6. **۳:۰۰ در بازارم:** show-to-seller card, tick items, mark one «موجود نیست» (shown as «گزارش شما»), replan with a diff and «برگرداندن».
7. **۳:۴۵ ادامه‌ی برنامه:** reload/close and reopen: the plan is there.
8. **۴:۱۵ ناموفق:** "لپ‌تاپ" → honest empty state with real alternatives.
9. **۴:۳۰ شفافیت:** the data sheet.

---

## 11. UX validation (about 2.5 days)

- **First-time test with 3–5 Persian speakers who haven't seen the app, on real phones:** (1) «برای نصب ۴ دوربین چی لازمه؟» → time to first useful plan, taps taken, hesitation points; (2) «ضبط‌کننده نبود، چه کار می‌کنی؟»; (3) «جمعه باز است؟»; (4) close the browser, return, continue.
- **Comprehension checks:** can they explain "ناقص", "گزارش شما", "دقیقاً همین / جایگزین" in their own words?
- **Success targets:** useful plan in under 60 seconds for a specific request; under 2 minutes with questions; zero participants believe the stock is confirmed; zero confuse "گزارش شما" with the dataset price.
- **Failure drills:** AI off, laptop query, single-seller item, Friday, private browsing.
- **Device sweep:** 360×640 Android Chrome, iPhone Safari; RTL/bidi, Persian digits, keyboard-over-sheet behaviour, sticky controls.
- **Honesty audit:** every number traces to a field; no age-based styling; no phone numbers anywhere; user reports never in the dataset total.

---

## 12. Open items and assumptions to confirm
1. [REC] Default plan rule: cheapest complete plan unless another is within about 5% with fewer stops. Confirm or replace.
2. [REC] «تو» vs «شما» tone for copy.
3. [REC] User reports are device-local and never shared.
4. [ASM] Reading requirements from titles via the LLM is accurate enough for the three demo domains. Wrong parsing is mitigated by showing the interpreted requirement on every item and the one-tap «تغییر».
5. [ASM] Mall/floor parsing covers about 64% of shops; the rest show the full address.
6. [ASM] An LLM key and budget exist (D8).
7. Final product name (placeholder «همراه‌بازار»).

---

---
---

# PART B — UX v3.1 corrections and the technical implementation plan

v3 above is the approved baseline. Part B (1) corrects what you flagged and (2) turns the UX into an executable technical plan. Where B contradicts v3, **B wins**.
Tags as before. Everything user-facing stays Persian/RTL; developer material is English.

## B1. Essential UX corrections

### B1.1 Exact vs candidate vs alternative (replaces the v3 item states)

"Meets the stated specs" is not "this model". The states now separate what the user said from what we picked:

| State | Persian label | When | Counted in total |
|---|---|---|---|
| Exact model | «مدل مشخص» | The user typed a model code, or picked a model from the list | Yes |
| Suggested candidate | «پیشنهاد» + «یکی از ۱۵۴ مدل مطابق خواسته» | Meets every stated requirement, but several models do; we pick one by a **visible rule** (cheapest eligible, inside the budget if one was given) | Yes, flagged «با مدل پیشنهادی» |
| Alternative | «جایگزین» + what differs | Differs on a stated requirement, or its specs are incomplete | Yes, flagged |
| Needs information | «نیاز به اطلاعات» | A compatibility-critical or very discriminating detail is missing | **No** |
| Not found | «پیدا نشد» | No listing | No |
| Price unknown | «قیمت ثبت نشده» | Found, no usable price | No |

- A suggestion is never worded as exact. The row always shows the eligible count, the pick rule («ارزان‌ترین مطابق خواسته») and «انتخاب مدل» to see the others.
- A "specific" request (brand + megapixels) therefore still yields **a suggestion**, not an exact match. It costs zero taps, and it is honest.
- Products whose relevant attribute could not be read from the listing are never auto-picked when the user (or a compatibility rule) needs that attribute. They stay visible in the list as «مشخصات کامل نیست».

### B1.2 Compatibility: three levels, no false certainty

[OBS] What the dataset can establish (checked on the demo domains):

| Domain | Evidence in the data | Verdict |
|---|---|---|
| Camera signal type (IP / AHD / analog) | Present in titles of only about 37% of the 3,467 cameras; spec fields exist for about 59% but are sparse and inconsistent | Often **unknown** |
| Recorder type (NVR / XVR / DVR) | In about 74% of recorder titles | Mostly readable |
| Recorder channels | In titles of about 56% of recorders; spec field in about 22% | Partly readable |
| Supported protocols | Only in some spec blocks (e.g., «HDCVI/AHD/TVI/CVBS/IP»); at least one spec block has the wrong brand | Not reliable |
| Hard drives | About 14% of titles say «بنفش / Purple / Skyhawk / سورویلنس»; 76% don't say | Mostly unknown |
| Adapters | Voltage readable in about 25–30% of titles, current in about 50% | Partly readable |
| Phone case / screen protector vs phone model | A model token (A56, iPhone…) appears in 72% of case titles and 64% of protector titles | Seller-stated, usable |

So we only ever display three statuses, each worded differently:
- **«طبق عنوان آگهی»** (listing-stated): both sides state it in their own listing text. Example: the case says «Galaxy A56», the phone is the A56, or the recorder title says «۸ کانال» and there are 4 cameras.
- **«فرض عمومی؛ تأیید نشده»** (our assumption): a general rule we encode, e.g., analog cameras (AHD/HDCVI/TVI) connect to an XVR/DVR, IP cameras to an NVR; a recorder needs an internal SATA drive; cameras usually run on a 12-volt adapter. We **cannot verify these from the data** and say so.
- **«نامشخص»**: an attribute is missing.

UI rules:
- No green tick is ever used for compatibility. Chips are neutral for listing-stated, outlined for assumed, and an amber dot for unknown.
- A small «سازگاری» block in the plan lists each relationship with its chip and a short sentence, e.g.:
  - «ضبط‌کننده ۸ کانال برای ۴ دوربین» · «طبق عنوان آگهی»
  - «دوربین‌های AHD به ضبط‌کننده XVR وصل می‌شوند» · «فرض عمومی؛ تأیید نشده»
  - «هارد مخصوص ضبط تصویر» · «نامشخص»
- Every «فرض عمومی» or «نامشخص» line is copied onto the show-to-seller card as «از فروشنده بپرس»: «آیا این ضبط‌کننده با دوربین‌های AHD سازگار است؟»
- A listing-stated **conflict** (case says A57, the phone is A56) excludes the candidate by default and explains why in the options list.
- Compatibility rules exist only for CCTV and phone accessories. Elsewhere no compatibility claim is made at all.

### B1.3 Totals, partial plans and unknown prices

- A total is never a bare number when anything is missing. The total line always carries its coverage on the same line and at the same visual weight:
  - Complete: «جمع ۵ مورد: ۱۸٫۴ میلیون تومان». When it uses suggestions: add «با مدل‌های پیشنهادی».
  - Partial: «فقط ۳ از ۵ مورد: ۱۱٫۲ میلیون تومان» (outlined amount, amber coverage badge) + «بدون قیمت یا انتخاب: ضبط‌کننده، آداپتور».
- Plans are compared **only within the same coverage.** The plan with the most covered items is the primary plan; if full coverage is impossible, the best partial plan is labelled «ناقص» and no plan carries the words «ارزان‌ترین» or «کم‌توقف‌ترین» against a plan that covers more.
- Items with unknown price appear in the plan under «بدون قیمت» with their sellers listed; they add nothing to the subtotal.
- Totals use dataset prices only. User reports appear in a second labelled line (v3 6.7).

### B1.4 Questions: no fixed limit, a principled stopping rule

The "one question per item" cap is removed. Questions come from three sources, in this order of priority:
1. **Compatibility-critical unknowns** (e.g., «دوربین‌ها آنالوگ هستند یا تحت شبکه؟») — asked because a wrong guess breaks the purchase.
2. **Discriminating attributes** with the highest information value across the current candidate set (brand, resolution, channels, capacity…), taken only from attributes that are readable for most candidates.
3. **Budget**, offered as bands built from the candidate set's real price distribution.

Every question is skippable with «فرقی نمی‌کند»; one «کافیه، پیشنهاد بده» button ends questioning for that item at any time.
Stopping rule (no hidden price tolerance): ask while any source-1 unknown exists, or while the eligible list is longer than a single phone screen of option cards (a UI limit, not a quality judgement); otherwise stop. The user can always open the full list.
Question text is **templated Persian per attribute**, not generated, so it is fast and reliable without the LLM.

### B1.5 One screen, no overload: three views, one active question

The single working screen keeps its route but gets a top segmented control with **three views**:
- «فهرست» — requirements and questions. Resolved items collapse to one line; **only one question card is expanded at a time**; a strip shows «۲ مورد منتظر پاسخ است».
- «برنامه» — the plan, stops, compatibility, totals.
- «در بازارم» — the checklist only; requirements are hidden.
After typing, the user lands on «فهرست» when something needs answering, otherwise directly on «برنامه». A sticky bottom bar offers one next action («سؤال بعدی» / «ببین برنامه» / «شروع خرید»). Hierarchy: requirements → recommendation → plan → on-site actions, never all at once.

### B1.6 Thresholds replaced by principled behaviour

- **Plan alternatives:** no 5%/8% constants. Plans are generated as the **exact set of non-dominated options on (total price, number of stops)** at maximal coverage. Anything dominated is hidden; anything non-dominated is shown with its real deltas («۸۰۰ هزار تومان بیشتر، یک توقف کمتر»). With one option nothing is offered and the reason is given.
- **Default selection:** the preference the user stated or tapped («ارزان‌تر» / «کم‌توقف‌تر»), captured from text («نزدیک»، «ارزان») or the chips. Absent any preference: the cheapest at maximal coverage, with the alternatives' deltas visible. No tolerance rule.
- **Data hygiene** (the only fixed numbers, each documented and measured in the data-quality report): a price under 10,000 toman or above 10^12 is treated as «قیمت ثبت نشده» ([OBS] 1,645 offers under 1,000 toman, mostly placeholders like 100/111; one 7×10^17 outlier).

### B1.7 Other corrections
- Item cards show only one state label; the pick rule and eligible count live in the secondary line.
- The assistant never edits a plan directly. It changes the requirement state; the plan is recomputed and the diff is shown (B3.6).

---

## B2. Environment findings (verified) and what they imply

| Finding | Implication |
|---|---|
| Node 22.21 + npm 10 (also Node 20), Python 3.12, git, Docker 29, `gh` (logged in, scopes repo/workflow), SQLite 3.45 with FTS5. No pnpm. | One language (TypeScript) across data prep, server and web. SQLite FTS5 is usable locally and in Docker. Use npm workspaces. |
| Dataset: 273 MB CSV, 15 GB free disk, 15 GB RAM (about 5 GB free during analysis) | Stream the CSVs; never load products fully in memory. |
| npm and the Anthropic API are reachable through the proxy | Package installs and the LLM can be used from this machine. |
| **No LLM key in the environment** | The user must provide one (server-side env var only). The product must be fully usable without it. |
| Render connector is authorized (workspace «Soroush's workspace»); Netlify is authorized (no sites). Render deploys **from a git repo only** (no prebuilt image via the connector); `docker` runtime is supported. Vercel is not authorized. | Deploy a Docker web service on Render from the public GitHub repo. Netlify can't host the API, so it is not used. |
| Playwright browsers are not cached | Install Chromium once early (`npx playwright install chromium`); if blocked, fall back to manual device testing. |
| Dataset size means a **repo cannot contain the data** (GitHub 100 MB/file) | The slim database ships as a GitHub Release asset and is downloaded in the Docker build (B6). Whether redistributing derived data publicly is allowed is unconfirmed (see B7). |

---

## B3. Recommended technical approach

**One TypeScript monorepo, one container, one read-only SQLite file. The deterministic engine decides; the LLM only interprets words.**

### B3.1 Why this shape (alternatives rejected)

| Option | Verdict |
|---|---|
| Server-side engine + read-only SQLite in one Node container (**chosen**) | Low latency (in-process queries), simple deploy, nothing to keep warm except one service, easy to test, the LLM is optional. |
| Next.js on serverless with the DB bundled | Cold starts, bundle limits, filesystem quirks with a ~100 MB file; no gain for this app. |
| Postgres/Supabase | Adds a network hop and an operational dependency; no multi-user writes are needed. |
| Vector search / embeddings over 226k products | Costly to build, adds hosting complexity; most queries resolve through category + structured attributes. Not needed. |
| Client-side engine (ship the DB to the browser) | ~100 MB download on mobile networks. Rejected. |
| Multi-agent runtime | No user-visible gain; rejected. |

### B3.2 Stack
- **Language:** TypeScript everywhere. Monorepo with npm workspaces: `packages/core` (pure logic, shared types), `apps/server`, `apps/web`, `scripts/data`.
- **Data:** SQLite via `better-sqlite3`, FTS5 for text. Built offline by `scripts/data`.
- **Server:** Fastify + zod validation; serves the built web app and `/api/*`.
- **Web:** Vite + React + Tailwind CSS using **logical properties only** (`ms-`, `ps-`, `start-`…), a Persian variable font (Vazirmatn, self-hosted), Zustand with `persist` for local state, `react-router`. Bottom sheets are a small in-house component (focus trap, Esc, swipe). Persian numbers, toman and Jalali dates use built-in `Intl` (`fa-IR`, `fa-IR-u-ca-persian`), so no heavy date libraries.
- **LLM:** a thin `LlmClient` interface with an Anthropic implementation (fast model, JSON/tool output, 3-second budget). Replaceable by another provider without touching the engine.
- **Tests:** Vitest (unit + API integration), Playwright (mobile viewport e2e + screenshots).
- **Deploy:** Docker on Render; GitHub repo public; Release asset for the data.

### B3.3 Data preparation (`scripts/data`)

Input: the three CSVs (read-only). Output: `market.sqlite` (target ≤ about 120 MB, measured in M0), `quality-report.json`, and golden fixtures.

Steps:
1. **Stream and clean.**
   - Normalise text: ي→ی, ك→ک, Arabic/Persian digits → Latin for indexing, ZWNJ unified, whitespace collapsed. The original title is kept for display.
   - Price: `price_clean` = null when raw is null, under 10,000 or above 10^12; keep a reason code.
   - **Drop shop phone numbers, instagram and website** from the output entirely (never ship what the UI must not show). Keep the `fictional names` flag in metadata.
2. **Shops:** parse address → `mall_name` (alias-normalised: علاالدین/علاءالدین/علائدین → one key), `floor`, `unit`, keep the original address; `building_key` = mall key when present, else the coordinates rounded to about 11 m. Hours → per-weekday arrays with the 00:00–00:00 sentinel removed; `has_hours` flag; end 00:00 after a morning start → 24:00.
3. **Products:** domain-specific attribute extractors fill `attrs` JSON — brand (field or lexicon match), model codes (regex for letter-digit codes), numeric+unit tokens (MP, channels, TB, V, A, mm², m), device-model tokens (A56, iPhone 15…), recorder kind, camera signal. Each attribute has a **coverage figure per category** in the quality report. Unreadable stays null (never guessed).
4. **Offers:** warranty normalised into small codes plus the original text; `seller_title` kept only when it differs from the product title; last-changed date kept.
5. **Search index:** FTS5 over normalised title + seller titles + brand + model codes, with the category as an unindexed column; a `categories` table with normalised names and a hand-written **synonym table** for the demo domains (about 60 Persian synonyms: «دوربین مداربسته/دوربین نظارتی», «هارد/حافظه», «ضبط‌کننده/ دی‌وی‌آر/ ان‌وی‌آر»…).
6. **Gate:** the quality report must pass the checks in B5/M1 before the app depends on the file.

### B3.4 Components and responsibilities

| Component | Responsibility |
|---|---|
| `core/normalize` | Persian normalisation, digit conversion, tokenisation, bidi-safe helpers. |
| `core/extract` | Attribute extractors (shared by data prep and query parsing, so words map to the same keys). |
| `core/requirement` | Requirement model (`item`: text, qty, categories, constraints, budget, pinned product, preference) and the item-state classifier. |
| `server/parse` | Text → items. Deterministic parser (split on «،», «و», newline; quantity; model codes; brand lexicon; category vote over FTS hits) **plus** an LLM refinement constrained to shortlisted category names and a closed constraint schema. |
| `server/candidates` | FTS retrieval, constraint filtering with **pass / fail / unknown** per attribute, eligibility and the exact/suggested/alternative classification. |
| `server/questions` | Facets over the candidate set; compatibility-critical question first; entropy-based next question; budget bands from the real price distribution; Persian templates. |
| `core/compat` | A declarative rules table (CCTV, phone accessories) emitting derived constraints and evaluating chosen products into listing-stated / assumed / unknown. |
| `server/plan` | Pareto planner (B3.5), hours/day/time filtering, coverage and totals, reason sentences (templated). |
| `server/assist` | Free text → one action from a closed set; applies it to the requirement state; returns a templated Persian message. |
| `server/llm` | Provider interface, timeouts, retries, circuit breaker, redaction of logs. |
| `server/api` | Endpoints in B3.7, rate limiting, input size limits, health and metadata. |
| `web/design-system` | Tokens, RTL primitives, `Bdi` for Latin runs, price/number/date formatters, chips, sheets, toasts, skeletons. |
| `web/screens` | Home; Plan workspace with the three views; sheets (options, time, show-to-seller, assistant, about-data). |
| `web/store` | Versioned local persistence, share-link encode/decode, undo stack for AI edits. |
| `ops` | Dockerfile, Render config, env handling, smoke test, release-asset script. |

### B3.5 Recommendation and planning logic

**Per item (requirement → eligible candidates):**
1. Parse → item with qty, constraints (typed, from the closed schema), optional model code, optional budget, preference flags.
2. Retrieve: FTS within the voted categories, then filter every constraint as pass / fail / unknown.
3. Classify: model-code match → exact; all stated constraints pass → eligible; any `unknown` on an attribute the user or a compat rule needs → "incomplete specs" (listed, never auto-picked); a `fail` → alternative only if the user relaxes.
4. Compute: eligible count, price quantiles (cleaned), facets, next question.

**Across items (compatibility):** rules emit derived constraints from the items' *stated* requirements (e.g., recorder channels ≥ total camera quantity; recorder kind from the camera signal type). They never rely on a picked product. After the planner picks products, the same rules are re-evaluated on them to set the status chips (B1.2).

**Plan (exact optimisation, tiny problem):**
- Buildings (`building_key`) are the stops. For each building and item, take the cheapest valid offer among eligible products there (price × qty), respecting day/time hours when set and any excluded shops/malls.
- With ≤ 5 items the problem is a subset DP: `best[k][mask]` = minimum cost to cover `mask` using exactly `k` buildings; iterate buildings and sub-masks (about N×3^m×K, trivial for hundreds of buildings).
- Coverage first (largest mask), then the Pareto set over (cost, k). Ties inside the same (cost, k) are broken by compactness (smaller pairwise haversine spread).
- One item is bought at one stop (quantity is not split; stock is unknown).
- Stop order: nearest-neighbour from the densest stop by haversine, labelled «ترتیب پیشنهادی» (never a route). Distances between stops are straight-line.
- Output: ordered stops with offers, per-item state and compat chips, totals with coverage, the non-dominated alternatives with deltas, and templated reason sentences.

**Closed shops** at the chosen time are excluded from planning; options lists still show them with «بسته است».

### B3.6 AI integration (small, grounded, optional)

The LLM does three jobs; everything else is deterministic.
1. **Parse**: text → items, choosing categories only from a shortlist the server supplies and constraints only from a closed schema. Output validated by zod; invalid → fallback. A deterministic parse runs in parallel; the LLM result is used if it arrives within about 3 s, otherwise the deterministic result is used and never swapped in later (no UI jumping).
2. **Assistant**: free text → one action from a closed enum (`set_preference`, `exclude_shop`, `exclude_mall`, `only_open`, `swap_brand`, `relax_constraint`, `set_budget`, `add_item`, `remove_item`, `explain`). The server validates ids and applies the action to the requirement state; the plan is recomputed and the client shows the diff with «برگرداندن».
3. **Explain / unsupported**: short Persian text when no action fits. Post-check: any digit in model text that isn't in an allow-list of values supplied for that call is replaced by the templated message.
Everything else (questions, reasons, compat sentences, errors) is **templated Persian**, so the product is complete and correct with the LLM off. The system prompt and all outputs are Persian. Keys stay on the server; logs redact user text.

### B3.7 API surface
`POST /api/parse` · `POST /api/resolve` (candidate summary, facets, next question) · `POST /api/options` (models or sellers for an item) · `POST /api/plan` (full recompute from requirement state) · `POST /api/assist` · `GET /api/meta` (snapshot date, counts, data version) · `GET /api/health`. All stateless. The client sends the whole requirement state, so there is no server session.

### B3.8 Persistence
- `localStorage` key `plans:v1`, versioned and migrated; stores **requirements, answers, pins, preferences, day/time, mode, checklist marks and user reports**, not computed plans. Plans are recomputed on open, so they always match the dataset version; a mismatch shows a calm Persian notice.
- Autosave on every change with the visible indicator «✓ ذخیره شد روی همین گوشی».
- **Share link:** the requirement state is compressed into the URL hash (no server, no account). Opening it imports a copy.
- Storage failure → the quiet notice from v3 6.8.

### B3.9 Frontend implementation notes (RTL/Persian)
`<html lang="fa" dir="rtl">`; logical properties only; mirrored directional icons; every Latin run (model codes, English names) wrapped in `<bdi dir="ltr">`; Persian digits via `Intl`; numeric inputs normalise digits; ≥48 px touch targets; sheet focus handling and keyboard-over-sheet behaviour tested on a phone viewport; skeleton states in Persian; offline/404/500 pages in Persian; no English strings in the bundle except developer logs.

---

## B4. Implementation sequence

Dependencies: M0 → (M1 ∥ M2-shell) → M3 → M4 → M5 → M6.
Parallelism: M1, the design-system shell and the deploy pipeline are independent after M0 and can be built concurrently by separate workers in separate worktrees; each unit is later merged and verified.

| Milestone | Content | Depends on | Exit check |
|---|---|---|---|
| **M0 — Skeleton + deploy proof** | Repo, workspaces, a minimal Fastify + React page in Persian RTL, a **tiny slice** of the DB (e.g., 2k products), Dockerfile, GitHub repo, Render service, release-asset download, health endpoint. LLM key set as a Render env var. | The user supplies the LLM key and approves Render plan | The public URL serves the Persian page and `/api/health`; the measured full-DB size/RAM/latency estimate is recorded. |
| **M1 — Data layer** | Full `market.sqlite`; normalisers; address/hours/price cleaners; attribute extractors; synonym table; quality report. | M0 | Quality gates (below) pass; DB size ≤ budget; FTS query p95 under about 50 ms locally. |
| **M2 — Engine core** | Candidates + classification, question engine, compat rules, Pareto planner, templated Persian reasons. API endpoints for resolve/options/plan. | M1 | The scenario suite (B5) passes through the API with the LLM off. |
| **M3 — Web core** | Design system, Home, Plan workspace (three views), item cards/states, option sheet, plan block, totals/coverage, time sheet, persistence + resume. | M0, M2 (for real data; mock earlier) | Journey J1 works end-to-end on the deployed URL on a phone, LLM off. |
| **M4 — AI layer** | LLM parse + deterministic parity, assistant actions with diff/undo, circuit breaker, key handling. | M2, M3 | Fallback parity tests pass; the assistant demo cases work; killing the key leaves the app usable. |
| **M5 — On-site and honesty** | Show-to-seller sheet, checklist mode, report-back with separate styling, replan on «موجود نیست», about-data sheet, compat block, empty/failure states, share link. | M3, M4 | Journeys J2–J4 pass; the honesty audit passes. |
| **M6 — Hardening and delivery** | Mobile device sweep, accessibility pass, Persian copy review, performance, rate limiting and input limits, README (with Persian summary), demo seed projects, the video. | M5 | Acceptance criteria met; the final deploy is tagged. |

Process rules: **deploy at M0 and redeploy after each milestone**; every milestone ends with a verification pass by a fresh-context reviewer before moving on; work that touches the public endpoint, secrets or input validation is reviewed from a security perspective before M6.

**Calendar guardrails (not estimates):** it is 21 Oct; the deadline is 23 Oct 23:50. Feature freeze 23 Oct midday; recording and README in the final afternoon; submission with at least a couple of hours of buffer. M0 and M1 measurements determine whether M2–M5 scope holds; if M1's gates are not met by the end of 22 Oct morning, apply the cut list (B8).

---

## B5. Highest-risk assumptions and how they are validated

| # | Assumption | Validation (earliest milestone) | If false |
|---|---|---|---|
| 1 | Title-based attribute extraction is good enough for the demo domains | Label about 100 titles per domain (cameras, recorders, HDD, adapters, wire, phone accessories) and compute accuracy/coverage; **gate: wrong extractions rare enough that every error leaves the attribute unknown rather than wrong** (measured; no invented numeric target) | Treat the attribute as unknown for that domain; ask the user instead |
| 2 | Mall/floor/unit parsing from addresses | Hand-check about 50 addresses across the top malls | Show the full address as the primary location text |
| 3 | A ~100 MB SQLite file deploys and serves fast | M0 slice + full-size dry run in Docker; measure image size, memory, cold start | Trim columns, drop seller titles from the index, or split the index |
| 4 | An LLM key and sensible latency exist | Smoke call at M0/M4; measure p50/p95 | Run in deterministic mode; the assistant offers chips only |
| 5 | Compatibility rules are accurate | A domain-aware teammate reviews the rules table once; every rule is labelled «فرض عمومی» regardless | Delete the rule (becomes «نامشخص») |
| 6 | Pareto planner returns sensible plans on real data | Property tests (never worse coverage, deterministic, ≤ K alternatives) + the demo scenarios | Fall back to the single cheapest-per-item plan |
| 7 | Persian RTL/bidi quality on real phones | Device sweep (Android Chrome, iPhone Safari), a Persian reviewer | Fix before freeze; cut decorative UI first |
| 8 | Render deploy and the release-asset download work reliably | M0 proof; keep one tagged rollback | Switch to Fly.io (needs the user's login) |
| 9 | Redistributing derived data publicly is acceptable | Ask the organizers in M0 | Ship the repo without data; document `data:build`; deploy from a private artifact |
| 10 | Playwright can run here | Install in M0 | Manual device testing plus API-level tests |

Quality gates for the data (M1), all computed in `quality-report.json`: join integrity (3,792 shops with offers; 331,506 offers; 225,903 products), no phone numbers present, no price under 10,000 or above 10^12 in `price_clean`, hours without sentinel shifts, every category in the synonym table resolves, attribute coverage per domain recorded.

---

## B6. Deployment, testing and demo strategy

### Deployment
- Public GitHub repo (created with `gh`); `Dockerfile` multi-stage: build web, build server, download `market.sqlite` from the Release asset (build arg `DATA_URL`) with a checksum, run as a non-root user, health check.
- Render **Docker web service** from the repo (via the connected Render tools), paid starter instance recommended (free instances sleep and the demo can't tolerate a cold start; the decision is yours because of cost). Region closest to Iranian users that Render offers; verified by a latency check.
- Secrets (`LLM_API_KEY`) via Render env vars only; `.env.example` in the repo; logs never include user text or keys.
- Auto-deploy from `main`; every milestone is a tagged release; keep the previous tag as a one-step rollback.
- Public-endpoint safety: per-IP rate limit, a maximum input length, request timeouts, zod validation on every route, no user-supplied identifiers reaching SQL except through parameters.

### Testing (against real journeys, not just components)
- **Unit:** normalisers, extractors, price/hours/address cleaners, compat rules, the planner (property tests), question engine, formatters (Persian digits, toman, Jalali).
- **Scenario/API suite (LLM off):** the four request types plus each demo project, asserting item states, eligible counts, plan coverage, totals wording, and that no suggestion is ever labelled «مدل مشخص».
- **E2E (Playwright, 390×844 and 360×640, RTL):** J1–J4, resume after reload, share link import, Friday/evening planning, AI-off mode, laptop miss, screenshots for visual regression of the key screens.
- **Fresh-context verification** (a separate reviewer) after each milestone; adversarial prompts for the assistant (unsupported requests, injected instructions in product titles).
- **Manual:** a Persian speaker walks every sheet and error state on a phone; the honesty audit (no phone numbers, no age-based styling, reports separate, no green compatibility ticks).

### Demo (five minutes, Persian)
- Seed three saved projects (CCTV, electrical, phone) so recovery from a dead network never blocks the video; the live path uses the deployed URL.
- Script follows v3 section 10, adjusted for the corrected behaviour: the recorder question flow shows the compatibility-critical question; the plan shows «پیشنهاد» vs «مدل مشخص»; the compatibility block shows listing-stated vs assumed; the partial-total wording is shown once on purpose.
- Rehearse twice on the deployed build; record in segments; keep a fallback recording of each journey.

---

## B7. Pre-requisites and open decisions that need you

1. **LLM API key** (server-side), and which provider/model you are allowed to use. I assume Anthropic with a fast model; the app works without it.
2. **Render plan:** free tier sleeps; starter is recommended. Your account/cost decision.
3. **Dataset redistribution:** confirm with the organizers that a derived database may be published in a public GitHub Release; otherwise the repo ships without data.
4. **Product name** (placeholder «همراه‌بازار») and the **«تو/شما»** tone.
5. **Who reviews Persian copy** and who reviews the compatibility rules (a teammate with CCTV knowledge).

## B8. Acceptance criteria for the core journeys

**J1 — Plan a project (multi-item).** From the typed CCTV sentence on the deployed site, on a phone, with the LLM off: items are parsed; no more than the necessary questions appear one at a time; the plan shows stops with exact/suggested labels; the total shows its coverage; nothing suggested is called «مدل مشخص»; compatibility chips appear with the correct level.
**J2 — Simple search.** A specific request returns a candidate set with an honest label and the seller list; a loose one asks only the necessary questions, then shows results.
**J3 — Ambiguous request.** «سیم برق برای اتاق» yields «نیاز به اطلاعات» with the real range and follow-up questions including the sale unit; no price is totalled until resolved.
**J4 — Unsuccessful search.** «لپ‌تاپ» produces the Persian empty state with real alternatives; other items continue.
**J5 — Time and day.** Choosing Friday or an evening time flags closed stops, excludes them from the plan, and offers open alternatives; shops with no hours are never called closed.
**J6 — On-site and reports.** Show-to-seller shows listing facts plus «از فروشنده بپرس»; a «موجود نیست» report is visibly separate («گزارش شما»), is kept only on the device, never enters the dataset total, and triggers a replan with a diff and undo.
**J7 — Persistence.** After closing and reopening the browser, the plan, answers, checks and reports are intact; a share link opens a copy on another device.
**J8 — Reliability.** With the LLM key removed or the API timing out, J1–J7 still work; the user sees only the calm Persian notice.
**J9 — Language/RTL.** No English text in the UI; Latin model codes render in correct order; numbers, toman and Jalali dates follow Persian conventions; no layout breaks at 360 px.
**J10 — Performance.** Interactions that recompute the plan feel immediate on the deployed instance (measured and recorded; the target is set after the M0 measurement rather than assumed).

## B9. Strict prioritization

**Must finish (in this order):**
1. M0 deployed skeleton and the data layer with passing gates.
2. Candidates, item states, questions, planner, totals with coverage.
3. Home, Plan workspace (three views), option sheet, time sheet, persistence.
4. Show-to-seller, checklist, separate user reports, about-data, empty/failure states.
5. LLM parse + assistant with fallback.
6. Persian/RTL hardening, README, demo seeds, video.

**Cut in this order if time runs short:**
1. Share link → 2. Assistant free text (keep chips) → 3. Alternative plans display (keep the single best plan) → 4. Compatibility rules beyond the CCTV core (phone rules stay if cheap) → 5. Swap-seller tab → 6. Relative-position sketch/optional location → 7. Questions beyond compat-critical + brand + budget.
**Never cut:** honest states and totals, compatibility levels, no-phone-numbers guarantee, separate user reports, persistence, Persian/RTL quality, early deploy, a tested demo path.

## B10. Parallel work units (for later delegation; nothing is started)

| Unit | Scope | Suggested role |
|---|---|---|
| U1 | Monorepo, Dockerfile, CI-less deploy, GitHub repo, Render service, release asset script | executor |
| U2 | Data build: cleaners, address/hours parsing, extractors, FTS, quality report | senior-executor (correctness-critical) |
| U3 | Engine: candidates, questions, compat rules, Pareto planner, API | senior-executor |
| U4 | Parser/LLM/assistant with fallback and closed schemas | executor (+ security review of secrets and the public endpoint) |
| U5 | Design system and RTL primitives, formatters | executor |
| U6 | Screens and sheets, persistence, share link | executor ×2 (Home/workspace vs sheets/on-site) |
| U7 | Test suites (scenario, e2e), device sweep, verification passes | verifier / executor |
| U8 | Copy review, README, demo seeds, video | you + executor |
Each writing unit works in its own worktree, merged by an integrator, with fresh-context verification after each milestone.

---

**Approval request.** If this matches your intent, reply `approve` and I will exit Plan Mode so implementation can begin from M0 (after you provide the items in B7). Or list corrections. Nothing has been implemented.

---

# ERRATA (conductor, after M2 data checks)

1. **Laptops and everyday electronics ARE in the data.** The earlier statements "laptops and groceries are essentially absent" and "the category literally named لپ تاپ has no offers" were wrong: the category is «لپ تاپ و نوت بوک» (505 products, 24 shops with offers; 915 products in laptop-related categories). TVs, washing machines, fridges (~296 products), shoes, books and furniture exist too. The bazaar-belt electrical/lighting/CCTV/phone core is still the dominant mass, but the catalog is not limited to it.
2. **"In catalog" means** the request resolves to at least one real category with products. Items outside the compat/attribute domains use the generic path (title search, brand, price) without compatibility rules.
3. **Truly absent** (use for the unsuccessful-search demo and empty-state tests): groceries and food, e.g. «برنج هاشمی», «ماست پرچرب» («برنج» alone matches brass items only).
4. Everywhere the plan/UX copy says «لپ‌تاپ در فهرست این بازار پیدا نشد», read it as the empty-state template; the demo example becomes a grocery item.
