/**
 * Post-check of the only free LLM prose the product shows (action 'explain' / unsupported requests).
 * The prose is rejected (and the caller shows a templated message instead) when it contains:
 *  - any number that is not one of the data values supplied for this call (digits in any script);
 *  - money / magnitude words (amounts are only ever shown from data, in templated sentences);
 *  - claims the data cannot back (in stock, guaranteed, confirmed...);
 *  - a URL, an e-mail address, a phone-like digit run, markup / JSON / code characters;
 *  - an id-like token (letters glued to digits, underscores, «m:»-style keys) or any Latin word that is not in
 *    the data or the user's own text, or mostly Latin text (the UI is Persian);
 *  - a fragment of the system prompt (24 characters or more, compared without spaces and punctuation).
 */
import { normalizeFa, toLatinDigits } from '@app/core';
import { stripInvisible } from '../llm/sanitize.js';

export const MAX_PROSE_CHARS = 300;

export interface ProseEnv {
  /** Numbers that may appear (data values of this call and numbers the user wrote). */
  numbers: ReadonlySet<number>;
  /** Latin words that may appear (lower-case): from the data and the user's own text. */
  latinWords: ReadonlySet<string>;
  /** System prompts of this call: no fragment of them may be echoed. */
  secrets: readonly string[];
}

const URL_RE = /(?:https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|ir|net|org|io|me|app|info|co|xyz|site|online|shop|store)\b|t\.me\/|wa\.me\/)/i;
const EMAIL_RE = /[^\s@]+@[^\s@]+/;
const PHONE_RE = /(?:\+|00)?\d[\d\s\-–().]{6,}\d/;
const MARKUP_RE = /[<>{}[\]`\\|$#=]/;
const MONEY_RE = /(?:تومان|تومن|ریال|میلیون|میلیارد|هزار|درصد|٪|%)/;
const CLAIM_RE = /(?:موجود\s*(?:است|هست|هستند|هستن)|موجوده|موجودند|تضمین|قطعا|قطعاً|حتما|حتماً|تأیید\s*شده|تایید\s*شده|تأیید\s*می|تایید\s*می|اصل\s*است|اورجینال\s*است|ارسال\s*رایگان)/;
const META_RE = /(?:user_request|facts|system|prompt|instruction|assistant|پرامپت|دستورالعمل|دستورهای\s*سیستم|متن\s*سیستم|کلید\s*api|api\s*key)/i;
const ID_LIKE_RE = /(?:[A-Za-z]+[_:.-]?\d|\d+[_:.-]?[A-Za-z]|_|\b[mc]:)/;
const WINDOW = 24;

const squash = (s: string) => normalizeFa(s).replace(/[^\p{L}\p{N}]+/gu, '');

const windowCache = new Map<string, Set<string>>();
function windowsOf(secret: string): Set<string> {
  let w = windowCache.get(secret);
  if (!w) {
    w = new Set();
    const s = squash(secret);
    for (let i = 0; i + WINDOW <= s.length; i++) w.add(s.slice(i, i + WINDOW));
    if (windowCache.size > 16) windowCache.clear();
    windowCache.set(secret, w);
  }
  return w;
}

function leaksSecret(text: string, secrets: readonly string[]): boolean {
  const t = squash(text);
  if (t.length < WINDOW) return false;
  for (const secret of secrets) {
    const w = windowsOf(secret);
    for (let i = 0; i + WINDOW <= t.length; i++) if (w.has(t.slice(i, i + WINDOW))) return true;
  }
  return false;
}

/** Numbers in a text: Persian / Arabic / Latin digits, «٫» or '.' decimals, «٬» or ',' thousands separators. */
export function digitNumbers(text: string): number[] {
  const t = toLatinDigits(text).replace(/٫/g, '.').replace(/(\d)[٬,](?=\d{3}\b)/g, '$1');
  return [...t.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
}

/** The checked prose, or null when it must be replaced by a templated message. */
export function checkProse(raw: string | null | undefined, env: ProseEnv): string | null {
  if (typeof raw !== 'string') return null;
  const t = stripInvisible(raw.normalize('NFKC')).replace(/\s+/g, ' ').trim();
  if (t === '' || Array.from(t).length > MAX_PROSE_CHARS) return null;
  if (MARKUP_RE.test(t) || URL_RE.test(t) || EMAIL_RE.test(t)) return null;
  if (PHONE_RE.test(toLatinDigits(t))) return null;
  if (MONEY_RE.test(t) || CLAIM_RE.test(t) || META_RE.test(t)) return null;
  if (ID_LIKE_RE.test(toLatinDigits(t))) return null;
  for (const n of digitNumbers(t)) if (!env.numbers.has(n)) return null;
  const latin = t.match(/[A-Za-z]+/g) ?? [];
  for (const w of latin) if (!env.latinWords.has(w.toLowerCase())) return null;
  const latinLetters = latin.join('').length;
  const persianLetters = (t.match(/\p{Script=Arabic}/gu) ?? []).length;
  if (persianLetters === 0 || latinLetters > persianLetters / 3) return null;
  if (leaksSecret(t, env.secrets)) return null;
  return t;
}
