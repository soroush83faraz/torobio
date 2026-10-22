import { prep } from './numbers';

/**
 * Device-model keys for phones and the accessories that fit them.
 *
 * Key format (lower-case Latin, single spaces): "<family> <model>[ <variant>...]"
 *   iphone 15 pro max · iphone 16e · iphone se 2022 · galaxy a56 · galaxy a05s · galaxy s24 fe ·
 *   galaxy s24 ultra · galaxy z fold 6 · galaxy note 20 ultra · redmi note 13 pro · redmi 13c ·
 *   poco m6 pro · xiaomi 14t pro · moto g54 · honor 400 lite · huawei nova 11 · oppo reno 8t ·
 *   pixel 10 pro xl · nothing phone 2a plus · realme c55 · oneplus nord ce 3 · nokia 106 · vivo y31
 * A trailing " 4g" / " 5g" is kept when the listing states it; compare with deviceModelBase()
 * when one side does not state the network variant.
 */

const FA_WORDS: Array<[RegExp, string]> = [
  [/(?:آیفون|ایفون|آیفن|ایفن|اَیفون)/g, ' iphone '],
  [/(?:گلکسی|گلگسی|گالکسی|گلاکسی)/g, ' galaxy '],
  [/سام ?سونگ/g, ' samsung '],
  [/(?:شیائومی|شیامی|شیاومی|شیایومی)/g, ' xiaomi '],
  [/ردمی/g, ' redmi '],
  [/پوکو/g, ' poco '],
  [/موتورولا/g, ' motorola '],
  [/موتو/g, ' moto '],
  [/(?:هوآوی|هواوی)/g, ' huawei '],
  [/آنر/g, ' honor '],
  [/اوپو/g, ' oppo '],
  [/رنو/g, ' reno '],
  [/ریلمی/g, ' realme '],
  [/پیکسل/g, ' pixel '],
  [/نوکیا/g, ' nokia '],
  [/وان ?پلاس/g, ' oneplus '],
  [/ناتینگ/g, ' nothing '],
  [/فایند/g, ' find '],
  [/پرو ?مکس/g, ' pro max '],
  [/(?:الترا|اولترا|آلترا)/g, ' ultra '],
  [/پرو/g, ' pro '],
  [/مکس/g, ' max '],
  [/پلاس/g, ' plus '],
  [/لایت/g, ' lite '],
  [/مینی/g, ' mini '],
  [/نوت/g, ' note '],
  [/اف ای/g, ' fe '],
  [/نرمال/g, ' normal '],
];

const LETTER_FA = '\\u0620-\\u064A\\u066E-\\u06D3\\u06FA-\\u06FF';

function toLatinDeviceText(title: string): string {
  let t = ` ${prep(title)} `;
  for (const [re, rep] of FA_WORDS) {
    // only whole words (Persian neighbours are letters of another word)
    t = t.replace(new RegExp(`(?<![${LETTER_FA}])(?:${re.source})(?![${LETTER_FA}])`, 'g'), rep);
  }
  // Persian series letters glued or spaced before digits: «آ33» «اس 24» «ام 13» «جی54» «ایکس 7»
  t = t
    .replace(new RegExp(`(?<![${LETTER_FA}])آ\\s?(?=\\d)`, 'g'), ' a')
    .replace(new RegExp(`(?<![${LETTER_FA}])اس\\s?(?=\\d)`, 'g'), ' s')
    .replace(new RegExp(`(?<![${LETTER_FA}])ام\\s?(?=\\d)`, 'g'), ' m')
    .replace(new RegExp(`(?<![${LETTER_FA}])جی\\s?(?=\\d)`, 'g'), ' g')
    .replace(new RegExp(`(?<![${LETTER_FA}])ایکس\\s?(?=\\d)`, 'g'), ' x')
    .replace(new RegExp(`(?<=\\d)\\s?تی(?![${LETTER_FA}])`, 'g'), 't ')
    .replace(/(?<=(?:poco|redmi)\s)سی\s?(?=\d)/g, 'c')
    .replace(new RegExp(`(?<![${LETTER_FA}])می\\s?(?=\\d)`, 'g'), ' mi ')
    .replace(new RegExp(`(?<![${LETTER_FA}])ایر(?![${LETTER_FA}])`, 'g'), ' air ');
  // split glued variants: «17promax» «s22ultra» «15pro» «note15» «600lite»
  t = t
    .replace(/promax/g, 'pro max')
    .replace(/(\d)(pro|max|plus|ultra|lite|mini|fe|normal|neo|prime|edge)(?![a-z])/g, '$1 $2')
    .replace(/(iphone|note|redmi|poco|galaxy|pixel|reno|mate|nova|moto)(?=\d)/g, '$1 ')
    .replace(/(?<=[a-z0-9])\+/g, ' plus ')
    .replace(/\+/g, ' ')
    .replace(/\s+/g, ' ')
    // «redmi 13 c» «a 21 s» «17 t pro» «phone 2 a»: a lone series letter after the number
    .replace(/(?<=[a-z] ?\d{1,3}) ([acest])(?![a-z0-9])/g, '$1');
  return t;
}

const VARIANT = '(?:pro max|pro|max|plus|ultra|lite|mini|fe|neo|prime|core|edge|play|power|stylus|xl|gt|nfc|5g|4g|normal|s)';
const VARIANTS_RE = `((?:\\s${VARIANT}(?![a-z0-9]))*)`;

function variants(raw: string | undefined, allowS = false): string[] {
  if (!raw) return [];
  const out: string[] = [];
  const toks = raw.trim().split(/\s+/);
  for (let i = 0; i < toks.length; i++) {
    let v = toks[i] as string;
    if (v === 'pro' && toks[i + 1] === 'max') { v = 'pro max'; i++; }
    if (v === 'normal') continue;
    if (v === 's' && !allowS) continue;
    if (!out.includes(v)) out.push(v);
  }
  // network variant last
  out.sort((a, b) => Number(/^[45]g$/.test(a)) - Number(/^[45]g$/.test(b)));
  return out;
}

function key(parts: Array<string | undefined>, vars: string[]): string {
  return [...parts.filter(Boolean), ...vars].join(' ').replace(/\s+/g, ' ').trim();
}

interface Rule {
  re: RegExp;
  build: (m: RegExpMatchArray) => string | null;
}

const NB = '(?<![a-z0-9-])'; // left boundary: not inside another code
const RB = '(?![a-z0-9])';

const IPHONE_NUM = /^(?:[4-9]|1[0-9])$/;

const RULES: Rule[] = [
  {
    re: new RegExp(`${NB}iphone\\s?(\\d{1,2}|xs|xr|x|se)(e)?${RB}((?:\\s(?:pro max|pro|plus|mini|max|air)${RB})*)(?:\\s(20(?:16|20|22)))?`, 'g'),
    build: (m) => {
      const n = m[1] as string;
      if (/^\d+$/.test(n) && !IPHONE_NUM.test(n)) return null;
      const year = n === 'se' && m[4] ? m[4] : undefined;
      return key(['iphone', n + (m[2] ?? ''), year], variants(m[3]));
    },
  },
  {
    re: new RegExp(`${NB}(?:galaxy|samsung)(?:\\s(?:galaxy|samsung))?\\s?(?:(z)\\s?(fold|flip)\\s?(\\d)|(note)\\s?(\\d{1,2})|([amsfc])\\s?(\\d{1,2})(s?))${RB}${VARIANTS_RE}(?:\\s\\(?(20[12]\\d)\\)?)?`, 'g'),
    build: (m) => {
      const vars = variants(m[9], true);
      if (m[1]) return key(['galaxy', 'z', m[2], m[3]], vars);
      if (m[4]) return key(['galaxy', 'note', m[5]], vars);
      let model = `${m[6]}${m[7]}${m[8] ?? ''}`;
      if (vars[0] === 's' && !m[8]) { model += 's'; vars.shift(); }
      // a year names a different body: «Galaxy A7 2016» != «Galaxy A7 (2018)»
      return key(['galaxy', model, m[10]], vars.filter((v) => v !== 's'));
    },
  },
  {
    re: new RegExp(`${NB}redmi\\s?(note\\s?)?(\\d{1,2}[a-z]?|a\\s?\\d|k\\s?\\d{2})${RB}${VARIANTS_RE}`, 'g'),
    build: (m) => key(['redmi', m[1] ? 'note' : undefined, (m[2] as string).replace(/\s/g, '')], variants(m[3], true)),
  },
  {
    re: new RegExp(`${NB}poco\\s?([xmfc])\\s?(\\d{1,2})${RB}${VARIANTS_RE}`, 'g'),
    build: (m) => key(['poco', `${m[1]}${m[2]}`], variants(m[3])),
  },
  {
    re: new RegExp(`${NB}xiaomi\\s(?:redmi\\s)?note\\s?(\\d{1,2})${RB}${VARIANTS_RE}`, 'g'),
    build: (m) => key(['redmi', 'note', m[1]], variants(m[2])),
  },
  {
    re: new RegExp(`${NB}(?:xiaomi|mi)\\s?(\\d{1,2}t?)${RB}${VARIANTS_RE}`, 'g'),
    build: (m) => {
      const n = parseInt(m[1] as string, 10);
      if (n < 8 || n > 18) return null;
      return key(['xiaomi', m[1]], variants(m[2]));
    },
  },
  {
    re: new RegExp(`${NB}(?:motorola\\s)?moto(?:rola)?\\s?(?:moto\\s)?([gez])\\s?(\\d{1,3}s?)${RB}${VARIANTS_RE}`, 'g'),
    build: (m) => key(['moto', `${m[1]}${m[2]}`], variants(m[3])),
  },
  {
    re: new RegExp(`${NB}motorola\\s([gez])\\s?(\\d{1,3})${RB}${VARIANTS_RE}`, 'g'),
    build: (m) => key(['moto', `${m[1]}${m[2]}`], variants(m[3])),
  },
  {
    re: new RegExp(`${NB}motorola\\s(?:moto\\s)?edge\\s?(\\d{2})${RB}${VARIANTS_RE}`, 'g'),
    build: (m) => key(['moto', 'edge', m[1]], variants(m[2])),
  },
  {
    re: new RegExp(`${NB}honor\\s?(x\\s?\\d{1,2}[a-z]?|magic\\s?\\d|\\d{1,3})${RB}${VARIANTS_RE}`, 'g'),
    build: (m) => key(['honor', (m[1] as string).replace(/\s/g, '').replace(/^magic/, 'magic ')], variants(m[2])),
  },
  {
    re: new RegExp(`${NB}huawei\\s?(p\\s?\\d{2}|mate\\s?\\d{2}|nova\\s?\\d{1,2}[a-z]?|y\\s?\\d{1,2}[a-z]?)${RB}${VARIANTS_RE}`, 'g'),
    build: (m) => key(['huawei', (m[1] as string).replace(/^(p|y)\s?/, '$1').replace(/^(mate|nova)\s?/, '$1 ')], variants(m[2])),
  },
  {
    re: new RegExp(`${NB}(?:oppo\\s)?reno\\s?(\\d{1,2}[a-z]?)${RB}${VARIANTS_RE}`, 'g'),
    build: (m) => key(['oppo', 'reno', m[1]], variants(m[2])),
  },
  {
    re: new RegExp(`${NB}oppo\\s(?:(find)\\s?x\\s?(\\d)|([af])\\s?(\\d{1,3}))${RB}${VARIANTS_RE}`, 'g'),
    build: (m) => (m[1] ? key(['oppo', 'find', `x${m[2]}`], variants(m[5])) : key(['oppo', `${m[3]}${m[4]}`], variants(m[5]))),
  },
  {
    re: new RegExp(`${NB}(?:google\\s)?pixel\\s?(\\d{1,2}a?)${RB}${VARIANTS_RE}`, 'g'),
    build: (m) => key(['pixel', m[1]], variants(m[2])),
  },
  {
    re: new RegExp(`${NB}nothing\\sphone\\s?\\(?\\s?(\\d)\\s?\\)?\\s?(a)?${RB}${VARIANTS_RE}`, 'g'),
    build: (m) => key(['nothing', 'phone', `${m[1]}${m[2] ?? ''}`], variants(m[3])),
  },
  {
    re: new RegExp(`${NB}realme\\s?(c\\s?\\d{2}|gt\\s?\\d?|narzo\\s?\\d{2}|\\d{1,2}[ist]?)${RB}${VARIANTS_RE}`, 'g'),
    build: (m) => key(['realme', (m[1] as string).replace(/^c\s?/, 'c').replace(/^(gt|narzo)\s?/, '$1 ')], variants(m[2])),
  },
  {
    re: new RegExp(`${NB}oneplus\\s?(nord\\s?(?:ce\\s?)?\\d?|\\d{1,2}[rt]?)${RB}${VARIANTS_RE}`, 'g'),
    build: (m) => key(['oneplus', (m[1] as string).replace(/\s+/g, ' ')], variants(m[2])),
  },
  {
    re: new RegExp(`${NB}nokia\\s?(?:(20[0-3]\\d)\\s)?(\\d{3,4}|[cgx]\\s?\\d{1,2})(?:\\s\\(?(20[0-3]\\d)\\)?)?${RB}`, 'g'),
    // «نوکیا 2017 130» / «Nokia 105 (2019)»: the year is a variant, never the model number
    build: (m) => {
      const n = (m[2] as string).replace(/\s/g, '');
      if (/^20[0-3]\d$/.test(n)) return null;
      return key(['nokia', n, m[1] ?? m[3]], []);
    },
  },
  {
    re: new RegExp(`${NB}vivo\\s?([yvx]\\s?\\d{2,3}[a-z]?)${RB}`, 'g'),
    build: (m) => key(['vivo', (m[1] as string).replace(/\s/g, '')], []),
  },
];

/** Bare Samsung series codes («A56», «S24 FE») accepted only with Samsung context. */
const BARE_SAMSUNG = new RegExp(`${NB}(?:(z)\\s?(fold|flip)\\s?(\\d)|(note)\\s?(\\d{1,2})|([amsf])\\s?(\\d{1,2})(s?))${RB}${VARIANTS_RE}(?:\\s\\(?(20[12]\\d)\\)?)?`, 'g');
/** Bare Xiaomi forms («Note 13 Pro», «13C») with Xiaomi context. */
const BARE_XIAOMI = new RegExp(`${NB}(note)\\s?(\\d{1,2})${RB}${VARIANTS_RE}`, 'g');
/** Bare iPhone numbers in a list after an iPhone match: «iPhone 13 / 13 Pro / 14 / 16e». */
const IPHONE_LIST_ITEM = /^\s?(?:\/|,|،|و|-|\|)\s?(?:iphone\s?)?(\d{1,2})(e)?(?![a-z0-9])((?:\s(?:pro max|pro|plus|mini|max|air)(?![a-z0-9]))*)/;

export type DeviceFamilyContext = 'samsung' | 'xiaomi' | 'apple' | null;

function familyContext(text: string, brandKey?: string | null): DeviceFamilyContext[] {
  const ctx = new Set<DeviceFamilyContext>();
  if (/(?<![a-z])(samsung|galaxy)(?![a-z])/.test(text) || brandKey === 'samsung') ctx.add('samsung');
  if (/(?<![a-z])(xiaomi|redmi|poco)(?![a-z])/.test(text) || brandKey === 'xiaomi') ctx.add('xiaomi');
  if (/(?<![a-z])(iphone|apple)(?![a-z])/.test(text) || brandKey === 'apple') ctx.add('apple');
  return [...ctx];
}

/**
 * All device models named in a title (accessory titles often list several).
 * `brandKey` (from the brand_name field) supplies family context for bare codes.
 */
export function extractDeviceModels(title: string | null | undefined, brandKey?: string | null): string[] {
  if (!title) return [];
  let t = toLatinDeviceText(title);
  const found: string[] = [];
  const add = (k: string | null) => { if (k && !found.includes(k)) found.push(k); };
  for (const rule of RULES) {
    t = t.replace(rule.re, (...args) => {
      const m = args.slice(0, -2) as unknown as RegExpMatchArray;
      const offset = args[args.length - 2] as number;
      const k = rule.build(m);
      if (!k) return m[0] as string;
      add(k);
      if (k.startsWith('iphone ')) {
        // list continuation
        let rest = t.slice(offset + (m[0] as string).length);
        let consumed = '';
        for (;;) {
          const lm = rest.match(IPHONE_LIST_ITEM);
          if (!lm || !IPHONE_NUM.test(lm[1] as string)) break;
          add(key(['iphone', (lm[1] as string) + (lm[2] ?? '')], variants(lm[3])));
          consumed += lm[0];
          rest = rest.slice(lm[0].length);
        }
        void consumed;
      }
      return ' § ';
    });
  }
  const ctx = familyContext(t, brandKey);
  if (ctx.length === 1 && ctx[0] === 'samsung') {
    t.replace(BARE_SAMSUNG, (...args) => {
      const m = args.slice(0, -2) as unknown as RegExpMatchArray;
      const vars = variants(m[9], true);
      if (m[1]) add(key(['galaxy', 'z', m[2], m[3]], vars));
      else if (m[4]) add(key(['galaxy', 'note', m[5]], vars));
      else {
        let model = `${m[6]}${m[7]}${m[8] ?? ''}`;
        if (vars[0] === 's' && !m[8]) { model += 's'; vars.shift(); }
        add(key(['galaxy', model, m[10]], vars.filter((v) => v !== 's')));
      }
      return ' § ';
    });
  }
  if (ctx.length === 1 && ctx[0] === 'xiaomi') {
    t.replace(BARE_XIAOMI, (...args) => {
      const m = args.slice(0, -2) as unknown as RegExpMatchArray;
      add(key(['redmi', 'note', m[2]], variants(m[3])));
      return ' § ';
    });
  }
  return found;
}

/** Key without a trailing network variant: «galaxy a52 5g» -> «galaxy a52». */
export function deviceModelBase(k: string): string {
  return k.replace(/\s[45]g$/, '');
}
