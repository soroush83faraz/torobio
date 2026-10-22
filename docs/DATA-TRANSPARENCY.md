# Data transparency

What the app knows, where each fact comes from, what we derived, what we threw away, what is wrong in the data, and
how the UI shows uncertainty. Numbers are from the local build of `market.sqlite` (snapshot 2026-10-13, data version
`2026-10-13.s1`) and `data/quality-report.json` (all gates pass). Schema: [DATA_SCHEMA.md](DATA_SCHEMA.md); attribute
dictionary: `packages/core/src/extract/ATTRIBUTES.md`.

## 1. Source and size

The organisers' export "Starcoach v16 cap300" (three UTF-8 CSV files; **not in this repository**, see README for how to
build the database). Its own note: each shop has **at most 300 distinct products** (the cap), shop descriptions and
catalogue coverage are omitted.

| | Rows |
|---|---|
| Shops | 6,476 (3,792 have at least one offer) |
| Products | 225,903 (every product has at least one offer) |
| Offers (one shop selling one product) | 331,506 |
| Categories | 3,988 (3,428 with products) |
| Hand-written Persian synonyms (for the demo domains) | 117 |

Consequences stated in the UI and here: the snapshot is from 13 Oct 2026 (21 Mehr 1405); a listing means the shop
registered the item, not that it is in stock; because of the 300-product cap, a missing product at a shop does not mean
the shop does not carry it; the app's "about the data" sheet says the data covers about 10 % of Tehran's shops (a
figure from the project plan, which we cannot verify from the data alone) in the Ferdowsi, Sheikh Hadi and Baharestan
area. The `location_label` field of shops has 30 distinct values; Ferdowsi (3,282), Sheikh Hadi (1,587) and Baharestan (616)
hold 5,485 of the 6,476 shops.

About 84 % of products (190,649 of 225,903) have exactly one seller, so most plans have a single feasible choice. The app
says so («فقط یک فروشنده دارد») instead of inventing variety.

## 2. How each dataset field is used

| File | Field | Use |
|---|---|---|
| shops | `shop_id`, `name` | Shop identity and display name. **Names are not real** (the build note says the organisers may have fictionalised them); the UI says so. |
| shops | `address` | Shown in full («نشانی کامل») and parsed into mall name, floor and unit (see section 3). |
| shops | `lat`, `lon` | Real coordinates. Used for the building key when no mall is parsed and for straight-line distances between stops. |
| shops | `location_label` | Stored as `area_label`. |
| shops | `category_names` | Stored as the shop's declared categories (not shown as offers; a shop with no listing is never a seller). |
| shops | `weekly_hours` | Parsed into per-day shifts (section 3). |
| shops | `supports_fast_delivery` | Stored; **not used** in the UI or the planner. |
| shops | `payment_options` | Not stored. |
| shops | `contacts`, `instagram`, `website_url` | **Dropped on purpose** (section 4). |
| products | `persian_title` | Shown as the listing title; normalised copy is indexed for search; attributes are extracted from it. |
| products | `category_name` | Category; routes the product to an extraction domain. |
| products | `brand_name` | Brand when present; else a single unambiguous lexicon match in the title. |
| products | `model` | Used only as a labelled fallback (for example the device model of an accessory when the title names none). |
| products | `specs` | Only strictly formatted values, marked `_src: 'spec'` (at most 3 % of a domain per attribute); **never for cameras** (inconsistent between sellers). |
| products | `image_urls` | First URL stored; **not used** in the UI. |
| offers | `price_toman` | Cleaned (section 3); the only price source. |
| offers | `seller_title` | Kept when its search tokens differ from the product title (150,882 kept); shown as the listing's own words. |
| offers | `warranty` | Normalised into a code (`company`, `authenticity`, `on_site_test`, `none`, `other`) plus the original text and months. |
| offers | `last_price_changed_at` | Shown as a plain date on every row, styled identically (no colour or ordering by age). Dates range from 2020-12-03 to 2026-10-13. |
| offers | `description` | **Dropped.** |

## 3. What is derived

### Attributes read from titles

Absent key means unknown; a value is written only when the listing establishes it, and when sources disagree the key is
left out. The same extractors run at build time and on the user's words, so both sides map to the same keys.
Coverage on the products of each domain (percent of products with the attribute; from `quality-report.json`):

| Domain (products) | Attribute coverage |
|---|---|
| CCTV cameras (3,909) | megapixels 59 %, signal type (IP / analog family) 49 %, body form 27 %, PTZ 16 %, brand 58 % |
| Recorders (871) | kind NVR / XVR / DVR 91 %, channels 87 %, brand 65 % |
| Hard drives and SSD (653) | capacity 94 %, SSD or HDD 88 %, surveillance line 66 %, brand 89 % |
| Adapters (1,707) | volts 77 %, amps 77 %, watts 13 %, brand 3 % |
| Building wire (5,274) | section 85 %, cores 85 %, strand 64 %, **sale unit 29 %**, brand 20 % |
| Phones (815) | storage 65 %, device model 64 %, RAM 50 %, network 28 %, brand 98 % |
| Phone accessories (6,137) | fits-which-phone 77 %, brand 82 % |
| Chargers (1,212) / power banks (755) | watts 76 % / capacity (mAh) 90 % |
| Headphones (1,339) | wired or wireless 89 % |
| Lighting (5,022) | watts 87 % |
| Switches and sockets (1,481) | brand only (70 %) |

Overall, 28.8 % of all 225,903 products have a brand and 32.2 % have a model code. Accuracy was measured on 465 labelled
titles plus 210 held-out titles: 0 wrong values and 0 unsupported claims, from small samples ("errors are rare", not a
guarantee). Reproduce with `npm run labels -w @app/data`. Listing flags («کارکرده / استوک», «ریفربیش», «کپی یا طرح»)
are detected from titles; absence of a flag is **not** a claim that the item is new.

### Mall, floor, unit

Parsed from the free-text address. All shops: mall name 61 %, floor 66 %, unit 72 %; shops with offers: 64 %, 69 %, 75 %.
Spelling variants are folded («علاالدین / علاءالدین / علائدین» become one building); «علاالدین ۲» and similar are separate
buildings. 2,654 buildings are the planner's stops: 501 malls and the rest groups of shops by coordinates rounded to
about 11 m. When parsing fails the full address is the primary location text. Floors are canonical («منفی ۲»,
«همکف»...).

### Opening hours

4,472 shops (69.1 %) have hours; among shops with offers 3,011 of 3,792 (79.4 %). Rules:

- A shop without hours is **never treated as closed** (it shows «ساعت کاری ثبت نشده»): 2,004 shops, 781 of them with offers.
- The `00:00` to `00:00` second shift is a sentinel and is dropped (23,390 shifts). Declared-empty days (61) mean closed.
- **The Friday rule.** 97 shops declare `00:00-23:59` on some day; 85 of them on Friday. For 64 shops that declare it on
  Friday but have only normal hours on every other open day, we treat Friday as **unknown** instead of "open 0 to 24"
  (7 % of shops open on Friday with normal weekdays, against 0.6 % for any other single weekday). The other shops are
  left as declared (12 declare round-the-clock on all seven days). The rule is in `scripts/data/src/clean/hours.ts` and is
  applied again when the server reads the database (`apps/server/src/adapter/rows.ts`), so a database built before the
  rule reads the same way. After the rule, 876 of 4,472 shops with hours are open on Friday (19.6 %); 3,473 are closed
  and 123 unknown. The time sheet's hint says "about 19 %".
- "Evening" means 18:00, "noon" 13:00, "morning" 10:00; an exact time can be typed.

### Prices

`price_clean` is null when the raw price is missing, under 10,000 toman or above 10^12 (kept with a reason code). Of
331,506 offers:

| Flag | Offers | Meaning |
|---|---|---|
| ok | 311,235 | usable price |
| missing | 15,083 | no price in the data |
| placeholder | 5,062 | under 10,000 toman (mostly values such as 100 or 111) |
| outlier | 126 | above 10^12 (one 7x10^17 value) |

216,059 of 225,903 products (95.6 %) have at least one usable price. Products without a usable price show «قیمت ثبت نشده»,
are left out of totals, and the total says so. **Unit confusion:** a wire listing may carry a per-metre price against a
100 m roll. For each wire, prices are converted to a per-metre figure by the listing's own unit; an offer more than about
4.6 times away from the typical per-metre price of the same wire loses its price (395 of 1,958 judged offers); 89 of
5,274 wire listings end up «مشخصات کامل نیست» with the sentence explaining the unit doubt. Before the sale unit is
chosen, no wire price range is shown and no total is computed. Evidence and the full rule set:
[AUDIT-suggestions.md](AUDIT-suggestions.md).

### Suggestion plausibility (what is never auto-picked)

A listing whose title head names another kind of goods (an AirPods cover filed under smart watches, a DC plug under
adapters), a listing that does not state a spec the user typed, used / refurbished / replica listings, and listings whose
unit is unclear are never automatically picked or offered as the closest alternative. They stay visible in the options list
(«جایگزین» or «مشخصات کامل نیست») with the reason. Before these rules, 24 of 73 audited first suggestions were the wrong
kind of thing or unit; the audit lists the remaining debatable picks.

## 4. What is dropped on purpose

- **Phone numbers** (`contacts`), **Instagram** and **website** of shops: never written to the database. The build gates
  check that no contact column exists and that no phone number appears in any text field (0 found in shop names, addresses,
  mall names, product titles, seller titles or warranty text). The UI never shows a phone number; an e2e check scans each
  page for phone patterns.
- Offer `description`, shop descriptions (not in the export), `payment_options`.
- Nothing about users is stored on the server. Requirements are typed by users, never logged or stored server-side.

## 5. Known data quality issues

- **Placeholder prices** (5,062 offers under 10,000 toman), missing prices (15,083), outliers (126). Handled as above.
- **Unit confusion** between per-metre and per-roll wire prices; only 29 % of wire titles state the sale unit.
- **Friday 00:00-23:59** placeholders (97 shops), plus 61 declared-empty days and 2,004 shops with no hours at all.
- **Old last-change dates.** Some listings were last changed in 2020 to 2023. The date is shown, not judged.
- **Mixed digits and spellings.** Latin (about 309k) and Persian (about 32k) digits, Arabic ي / ك, ZWNJ variants: normalised for search; the
  original title is what the UI shows.
- **Accessories are filed in the product's category** (covers under smart watches, plugs under adapters): handled by the title-head rule.
- **Wrong brand in some spec blocks**, so specs are used only in strict formats and never for cameras.
- **Brand semantics.** In accessory categories the dataset brand is the **device** brand (a case for an iPhone has brand «اپل»).
- **The 300-products-per-shop cap** and **fictional shop names** (section 1).
- **Quality report size note.** The database is 130.5 MB against a 120 MB target (`size_within_target: false`); accepted.

## 6. How uncertainty is shown in the UI

| Situation | What the user sees |
|---|---|
| A product chosen by a rule | «پیشنهاد», «یکی از ۲۹۱ مدل مطابق خواسته · قاعده: ارزان‌ترین مطابق خواسته». **Never** «مدل مشخص» unless the user typed a model code or picked a model. |
| Detail missing that matters | «نیاز به اطلاعات» and a question; not counted in the total. |
| Differs from what was stated, or specs incomplete | «جایگزین» with what differs, or «مشخصات کامل نیست». |
| Not in the data | «پیدا نشد», a calm list of what the data does contain; the plan continues without it. |
| Nothing matches the stated constraints | A dead-end card: why (for example "no model within a 50 million budget; the cheapest is 100.6 million"), the nearest models, and buttons to relax a constraint. Nothing is picked for the user. |
| Total | Always with coverage: «جمع ۴ مورد: ۲۰٫۳ میلیون تومان» and «با مدل‌های پیشنهادی»; or «فقط ۱ از ۲ مورد» with «پیدا نشد: ...». Incomplete plans are labelled «ناقص» and never called cheapest against a plan that covers more. |
| Compatibility | Three levels, no green tick: «طبق عنوان آگهی» (both listings state it), «فرض عمومی؛ تأیید نشده» (our general rule), «نامشخص» (attribute missing). A listing-stated conflict excludes the candidate by default, or stays visible as «ناسازگار» when the user's own choices conflict. Every assumed or unknown line is copied to the show-to-seller card as «از فروشنده بپرس». |
| Hours | «ساعت کار امروز: ۱۰ تا ۱۹», «در این زمان باز است», «در این زمان بسته است» (such stops are dropped from the plan with a sentence), «ساعت کاری ثبت نشده» (neutral). |
| Used, refurbished, replica | Hidden from automatic picks with «۷ مورد کارکرده یا کپی نمایش داده نشد» and «نشان بده». |
| Stock and price freshness | A permanent line under every plan: "prices are from the 21 Mehr list; stock is not confirmed"; the show-to-seller card says the price and availability may have changed. The price-change date is a plain date, styled the same on every row. |
| User reports | «گزارش شما» in a distinct outlined badge, «فقط روی همین دستگاه»; never mixed into dataset totals ("total per the list" and, only when reports exist, "total with your reports"). |
| Distances and order | «حدود ۱۸۳ متر تا توقف بعدی (خط مستقیم)» and «ترتیب پیشنهادی بر اساس نزدیکی است، نه مسیر پیاده». |
| LLM unavailable | A quiet line («جستجوی ساده فعال شد...»); the product stays fully usable. |
| The "about the data" sheet (ⓘ) | Five bullets (snapshot date, listing is not stock, names are fictional, coverage about 10 %, reports stay on device), the counts (3,792 shops with listings, 225,903 products) and what the assistant does and does not do. |

Note: the sheet's shop count is the number of shops **with offers** (3,792), the number the planner can use; the full
export has 6,476 shops.
