# Extracted product attributes (`products.attrs`)

`extractProduct({ title, categoryName, brandField, modelField, specs })` returns the
attributes it is **confident** about. The same functions run at build time (data) and can
run at query time (words map to the same keys).

## Conventions

- **Absent key = unknown.** A key is written only when the listing establishes the value.
  When sources disagree (title vs model code, two values in one title) the key is left out.
- Values are read from the **title**. A few attributes may also come from a manufacturer
  **model code** in the title (documented conventions, e.g. Dahua `HAC-` = HDCVI), the
  dataset **model field**, or a strictly formatted **spec** value (never for cameras). Those carry a source
  marker: `attrs._src = { <key>: 'model_code' | 'spec' | 'model_field' }`. A key without an
  `_src` entry was read from the title text itself. The UI's «طبق عنوان آگهی» applies to
  title and model-code values; spec/model-field values are seller/catalogue data.
- `brand_key` (all domains): stable Latin slug of the brand (`dahua`, `hikvision`, `wd`,
  `samsung`…), or `fa:<normalised Persian>` for a brand_name value outside the lexicon.
  `products.brand` holds the Persian display name. Brand comes from the dataset
  `brand_name` field when present; otherwise from a lexicon match in the title, only if
  exactly one brand is named and the category is not a "made for another device"
  category (cases, parts, adapters, chargers, car parts…). In accessory categories the
  dataset itself uses the **device** brand (a case for an iPhone has brand «اپل»).
- `condition` (all domains): `'used'` («استوک», «کارکرده», «کار کرده», «دست دوم», open-box /
  «اوپن باکس» / «پک باز شده», like-new «در حد نو» / «در حد آکبند» / «مشابه آکبند») or `'refurbished'`
  («ریفربیش», bazaar short form «ریفر», «Recertified»). A title offering both («کارکرده و آکبند») stays absent.
  **Absent = "not stated as used in the listing"** — it is NOT a claim that the item is new.
- `replica: true` (every extraction domain; never on the generic path, where «کپی» names photocopiers
  and copy paper): «کپی», «copy», «غیر اصل», «فیک», «طرح اصلی», phones also «گوشی طرح اپل/نوکیا…».
  Look-alikes (G3b): «طرح <brand>» right after «طرح» (اپل، ایرپاد، سامسونگ، نوکیا، ورتو، شیائومی، سونی، JBL… ) in phones, headphones,
  chargers and power banks; «طرح <Latin model>» («گوشی طرح S26 Ultra») in phones; «اورجینال نیست», «غیر اورجینال», «اصل نیست», «تقلبی»,
  «مشابه اصل(ی)», «ریپلیکا», clone / imitation. NOT replicas: «طرح دار», «طرح گل / چرم / ساده / فانتزی / گوزن / پرچم آمریکا», case styles
  («قاب طرح یانگ کیت»), «(چین)» regional versions. Known miss: «ایرپاد پرو طرح کیفیت درجه 1 و هلوگرام …» (no brand after «طرح»).
  Absent = not stated.
- Shared detector: `extractListingFlags(prepTitle(title), domain)`. The server also runs it on every
  title at query time and unites the result with the stored attrs, so detector improvements apply
  without a data rebuild (a flag is only ever added).
- Engine policy (core `ConditionMode`, `Requirement.condition`): by default a flagged listing is never
  eligible — not auto-picked, not an exact model-code match, not a closest alternative — and stays
  visible in the options list as «جایگزین» with its flag («کارکرده (استوک)»، «ریفربیش»، «کپی یا طرح»).
  `'any'` (user: «نو یا کارکرده», answer/chip) also accepts used/refurbished; `'used'` («موبایل استوک»)
  accepts only listings stating used/refurbished; `'replica'` («هندزفری کپی») only copies. A pinned
  product is taken as is.

Measured on the 2026-10-13 snapshot (products with offers; flagged before -> after the W3 detector
changes; every one of the 40 newly flagged titles was read and is correct, 0 wrong claims seen):
laptops («لپ تاپ و نوت بوک») 26/505 -> 26 used; phones 127/815 -> 127 (58 used, 70 copies); HDD 55/653
-> 58 (3 «ریفر» incl. a «هارد ریفر … دوربین مداربسته»); phone accessories 3/6137 -> 16 (LCD «کپی Gx»,
«COPY», «غیر اصل»); adapters 4 -> 5; chargers 12 -> 13; headphones 15 -> 16; wire 0 -> 1; cameras 7;
recorders, lighting, switch/socket, power banks 0. A 45-title random sample of flagged laptops/phones
was read: all correct. Known misses (left unknown on purpose): glued words («دست دومNikon»,
«استوک4110»), English «Second» on LCD parts.

## Routing (category name -> domain)

| domain | categories |
|---|---|
| `cctv_camera` | دوربین مدار بسته · دوربین امنیتی خورشیدی · دوربین‌های نظارتی و امنیتی · دوربین مخفی |
| `recorder` | ضبط کننده ویدیویی دوربین‌های نظارتی و امنیتی · ضبط کننده تصویر |
| `hdd` | هارد دیسک اینترنال · هارد سرور · حافظه SSD |
| `adapter` | آداپتور برق · منبع تغذیه سوییچینگ · سایر منبع تغذیه · منبع تغذیه |
| `wire` | سیم و کابل برق ساختمان |
| `phone` | گوشی موبایل · گوشی شیائومی |
| `phone_accessory` | کیف و کاور گوشی · محافظ صفحه نمایش گوشی · محافظ لنز دوربین گوشی · قاب، شاسی و درب گوشی · باتری گوشی موبایل · تاچ و ال سی دی گوشی و تبلت · گلس تعمیراتی گوشی و تبلت · شیشه دوربین گوشی و تبلت |
| `charger` | شارژر گوشی · شارژر وایرلس و پایه شارژ · شارژر فندکی خودرو |
| `power_bank` | پاوربانک و شارژر همراه |
| `headphones` | هدفون، هدست و هندزفری |
| `lighting` | پروژکتور و وال واشر · لامپ LED و کم مصرف · چراغ پنلی و سقفی · چراغ و پروژکتور خورشیدی |
| `switch_socket` | کلید و پریز · کلید هوشمند · پریز هوشمند (brand only) |

`products.domain` and `categories.domain` hold the routed domain (NULL elsewhere).

## Attributes by domain

### cctv_camera
| key | type | meaning |
|---|---|---|
| `mp` | number | megapixels stated («۲ مگاپیکسل», «5MP», «دو مگاپیکسل»; 4K=8, 1080p=2, 720p=1). Multi-lens cameras: the listing's total. Dahua `HFW/HDW…` and Hikvision `DS-2CD…`/`DS-2CE…[DHU]` codes decoded (`_src.mp='model_code'`) |
| `signal` | `'ip'｜'ahd'｜'hdcvi'｜'tvi'｜'analog'` | transmission. `ip`: IP/تحت شبکه/شبکه/PoE/IPC- codes/DS-2CD. `analog` = analog family: CVBS, «آنالوگ» alone, several HD-analog formats, Hikvision Turbo `DS-2CE`, Brighton `UVC-`, Uniview `UAC-`. A title naming both IP and an analog format => absent. Title and model code: a format the title names (TVI / «توربو» / Turbo HD / «تی وی آی», HDCVI / «سی وی آی», AHD / «ای اچ دی», also glued to Persian words or digits: «بالتAHD», «AHD2MP») wins over a code that only knows the analog family (Hikvision `DS-2CE`, Uniview `UAC-`); a title that says just «آنالوگ» is refined by `HAC-` = hdcvi (`_src.signal='model_code'`); several formats in the title (AHD/TVI/CVI) => `analog`; two different named formats (title AHD, `HAC-` code) or IP vs analog => absent |
| `ptz` | `true` | speed dome / PTZ / «چرخشی» / Hikvision `DS-2DE` / Dahua `SD…` |
| `wifi` | `true` | «وای فای», «بی سیم», wireless |
| `sim` | `true` | SIM-card / 4G camera |
| `form` | `'bullet'｜'dome'` | stated body type (absent for PTZ) |
| `solar` | `true` | solar camera |

### recorder
| key | type | meaning |
|---|---|---|
| `kind` | `'nvr'｜'xvr'｜'dvr'` | `xvr` also for hybrid/UVR/HVR («هایبرید»). A manufacturer code (`XVR…`, `NVR…`, `HCVR…`=dvr, Hikvision `DS-7xxxN…`=nvr / `DS-72xxH…`=dvr, Tiandy `TC-R3…`=nvr) wins over the seller's wording (`_src.kind='model_code'` when they differ). «تحت شبکه/شبکه» alone => nvr |
| `channels` | integer | «۸ کانال», «16CH», «ده کاناله»; or from Dahua/Hikvision/Tiandy/Brighton codes. Title and code disagree, or a list («4 و 8 کانال») => absent |

### hdd
| key | type | meaning |
|---|---|---|
| `tb` | number | capacity in TB (500 GB = 0.5). WD (`WD40PURZ`) and Seagate (`ST2000VX…`) codes decoded; disagreement with the title => absent |
| `line` | string | `purple｜skyhawk｜blue｜red｜gold｜black｜green｜barracuda｜ironwolf｜exos｜ultrastar` |
| `surveillance` | boolean | `true`: Purple/بنفش/SkyHawk/Surveillance/«مخصوص دوربین»/S300; `false`: another named line |
| `ssd` | boolean | `true` only for SSD titles; `false` when the title says HDD/هارد دیسک or names an HDD line |
| `form_factor` | `'3.5'｜'2.5'` | stated size or «لپ تاپ» |

### adapter (power supplies)
| key | type | meaning |
|---|---|---|
| `volts` | number | output voltage (mains 110/220 V is ignored). Absent for adjustable adapters |
| `amps` | number | output current («۵۰۰ میلی آمپر» = 0.5, «۲/۳۱» = 2.31) |
| `watts` | number | stated power |
| `variable` | `true` | adjustable output («3 تا 12 ولت», «متغیر») |
| `poe` | `true` | PoE injector/adapter |

### wire (building cable)
| key | type | meaning |
|---|---|---|
| `section_mm2` | number | conductor section, standard sizes only (0.5…630). «۲ در ۲/۵», «2.5x3», «سیم ۲/۵», «نمره ۱/۵». Reduced-neutral cables («3×95+50», «به علاوه») and AWG => absent |
| `cores` | integer | number of cores; 1 for single wires; 6–61 for control cables («24×1») |
| `sale_unit` | `'roll100'｜'meter'｜'other'` | `roll100` = «حلقه/کلاف ۱۰۰ متری»; `meter` = «متری», «قیمت متری», «۱ متر», «برش دلخواه»; `other` = another roll length or an unspecified roll. Both metre and roll stated => absent |
| `roll_m` | integer | roll length in metres when stated |
| `conductor` | `'copper'｜'aluminium'` | stated conductor (CCA => absent) |
| `strand` | `'flexible'｜'solid'` | «افشان/نایلونی» vs «مفتولی/خشک» |

### phone
| key | type | meaning |
|---|---|---|
| `storage_gb` | integer | «حافظه 128 رم 4 گیگابایت» → 128 (1 ترابایت = 1024). MB-class feature phones => absent |
| `ram_gb` | number | RAM in GB |
| `model_key` | string | device model key (format below); exactly one model in the title |
| `network` | `'5g'｜'4g'` | stated network |

### phone_accessory
| key | type | meaning |
|---|---|---|
| `fits_models` | string[] | every device model the title names, e.g. `["iphone 13","iphone 13 pro","iphone 14","iphone 16e"]`. Generic «مخصوص انواع گوشی» => absent. The dataset `model` field is used only when the title names none (`_src.fits_models='model_field'`) |

### charger / power_bank / headphones / lighting
| key | domain | meaning |
|---|---|---|
| `watts` | charger, power_bank, lighting | stated power |
| `mah` | power_bank | capacity in mAh («۲۰ هزار» = 20000) |
| `wireless` | headphones | `true` Bluetooth/بی سیم/TWS; `false` wired («باسیم», AUX) |

## Device model keys (`model_key`, `fits_models`)

Lower-case Latin, single spaces: `<family> <model>[ <year>][ <variant>…][ 4g|5g]`.
Families: `iphone`, `galaxy`, `redmi`, `poco`, `xiaomi`, `moto`, `honor`, `huawei`, `oppo`,
`pixel`, `nothing phone`, `realme`, `oneplus`, `nokia`, `vivo`.
Examples: `iphone 15 pro max`, `iphone 17 air`, `iphone 16e`, `galaxy a56`, `galaxy a05s`,
`galaxy s24 fe`, `galaxy s24 ultra`, `galaxy z fold 6`, `galaxy a7 2016`, `redmi note 13 pro 5g`,
`redmi 13c`, `poco m6 pro`, `xiaomi 11 lite`, `moto g54`, `honor 400 lite`, `nokia 105 2019`.
Variants are part of the identity (a case for `galaxy s24` does not fit `galaxy s24 ultra`).
A trailing network variant is kept when the listing states it; compare with
`deviceModelBase(key)` when only one side states it. Persian spellings are mapped
(«آیفون ۱۵ پرو مکس», «سامسونگ آ33», «گلس اس 24 اف ای»).

## Model codes (`products.model_codes`)

`extractModelCodes(title)`: Latin letter+digit runs of 4–30 characters (unit/technology
tokens such as `5MP`, `12V-2A`, `H.265`, `CAT6`, `2.8-12mm` are excluded), normalised with
`normalizeModelCode` (upper-case, separators removed). Stored primary codes first, then
variants: without the Dahua `DH-`/`DHI-` prefix and the main segment
(`DH-XVR5108-4KL-I3` → `DHXVR51084KLI3`, `XVR51084KLI3`, `XVR5108`). The same lower-cased
codes are in the FTS index, so a typed code matches with or without hyphens.

## Measured accuracy (scripts/data/labels, worker-labelled, title-only)

465 labelled titles (6 sets) + 210 held-out titles (6 sets drawn with other seeds and
labelled before scoring). Run `npm run labels -w @app/data`. All sets: **0 wrong values, 0
unsupported claims** (one held-out error — «Galaxy A7 2016» read as `galaxy a7` — was fixed
by the year rule). Coverage of labelled values: cameras mp/signal/ptz/wifi 100%; recorders
kind/channels 97–100%; HDD tb/surveillance/ssd 100%; adapters volts/amps 99–100%; wire
section/cores 89–100%, sale unit 100%; phone accessories fits_models 97–100%. These are
small samples; treat them as "errors are rare", not as guarantees. Spec-derived values
(`_src: 'spec'`, ≤ 3% of a domain per attribute: recorder channels, adapter volts/amps,
HDD tb, wire section/sale unit) are not covered by the labels; camera specs are not used at
all because they are inconsistent between sellers. Consumers that auto-pick products may
ignore `_src: 'spec'` values.

## Engine use of stated-spec keys (audit F3, docs/AUDIT-suggestions.md)

The server maps (apps/server/src/adapter/mapping.ts) `watts` -> `power_w` (lighting, charger, power_bank, adapter),
`mah` -> `capacity_mah` (power_bank) and `strand` -> `wire_strand` (wire). Screen size `screen_inch` is not stored:
`screenInchOf(prepTitle(title))` reads «۵۵ اینچ» / «15.6 inch» (one distinct value in 5..120) from any title at
query time and from the request. These engine attributes apply only when the user states them (not facet questions).
