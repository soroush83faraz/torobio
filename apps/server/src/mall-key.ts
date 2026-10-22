/**
 * Read-time normaliser for mall keys («m:…» building keys of market.sqlite).
 *
 * The data builder folds a mall name (spaces and punctuation removed) and keeps the spelling of the number, so the
 * same building can appear under several keys: «علاالدین 2», «علاالدین ۲» and «علاالدین دوم» fold to
 * `m:علاالدین2`, `m:علاالدین۲` (or a Latin/Persian digit variant) and `m:علاالدیندوم`. This maps all of them to one
 * key: digits (Persian / Arabic-Indic / Latin) become ASCII digits and a TRAILING ordinal word (اول … دهم) becomes
 * its digit. Only the end of the key is touched, and only when a name of at least two letters remains in front, so
 * «m:سوم» or a name that merely contains «اول» is left alone. Street keys («c:lat,lon») pass through unchanged.
 *
 * Not applied: «۱» is NOT folded into the unnumbered name (the data builder's alias map decides that building by
 * building, e.g. «علاالدین1» -> «علاالدین» but «علاالدین2» stays separate).
 */

const ORDINALS: ReadonlyArray<readonly [string, string]> = [
  ['اول', '1'],
  ['دوم', '2'],
  ['سوم', '3'],
  ['چهارم', '4'],
  ['پنجم', '5'],
  ['ششم', '6'],
  ['هفتم', '7'],
  ['هشتم', '8'],
  ['نهم', '9'],
  ['دهم', '10'],
];

const FA_LETTER = /[ؠ-يٮ-ۓۺ-ۿ]/;

function asciiDigits(s: string): string {
  return s
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/** The canonical form of a mall key; the input is returned unchanged when nothing needs folding. */
export function normalizeMallKey(key: string): string {
  if (!key.startsWith('m:')) return key;
  let name = asciiDigits(key.slice(2))
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[\s‌‍]+/g, '');
  for (const [word, digit] of ORDINALS) {
    if (!name.endsWith(word)) continue;
    const rest = name.slice(0, -word.length);
    // a name of two or more letters must remain; the ordinal is not glued to a longer word's tail (e.g. a digit run)
    if ([...rest].filter((c) => FA_LETTER.test(c)).length >= 2) {
      name = `${rest}${digit}`;
      break;
    }
  }
  return `m:${name}`;
}

/** Do two keys name the same building after normalisation? */
export function sameMall(a: string, b: string): boolean {
  return normalizeMallKey(a) === normalizeMallKey(b);
}
