import { Fragment, type ReactNode } from 'react';
import { sanitizeText } from '../lib/sanitize';

/** Isolates a Latin run (model code, English brand) so punctuation and digits never reorder. */
export function Bdi({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <bdi dir="ltr" className={`font-medium ${className}`}>
      {children}
    </bdi>
  );
}

/**
 * A Latin-script run: ASCII tokens (letters, digits, `. _ - +` inside) joined by single spaces or a slash.
 * It may START with a digit («4.2V», «12V 2A», «5G»); a matched run without any Latin letter («100», «4.2») is
 * left as plain text, so ordinary digits next to Persian words are never isolated.
 */
const TOKEN = '[A-Za-z0-9][A-Za-z0-9._\\-+]*';
const LATIN_RUN = new RegExp(`(${TOKEN}(?:(?:\\s?/\\s?|\\s)${TOKEN})*)`, 'g');
const HAS_LATIN = /[A-Za-z]/;

/** Trailing sentence punctuation is not part of a code («Galaxy A56.»). */
function splitTail(run: string): [string, string] {
  const m = /^(.*?[A-Za-z0-9])([._\-+]+)$/.exec(run);
  return m ? [m[1]!, m[2]!] : [run, ''];
}

/**
 * Renders a data-derived string (listing title, shop / mall / brand name, user text) with every Latin run in its own
 * LTR isolate. Persian stays RTL in the surrounding flow. The text is sanitised first (no bidi overrides / controls).
 */
export function BidiText({ text }: { text: string }) {
  const clean = sanitizeText(text ?? '');
  const parts = clean.split(LATIN_RUN);
  return (
    <>
      {parts.map((raw, i) => {
        if (i % 2 === 0 || !HAS_LATIN.test(raw)) return <Fragment key={i}>{raw}</Fragment>;
        const [part, tail] = splitTail(raw);
        return (
          <Fragment key={i}>
            {/* a model code never breaks at its hyphens; only a long run (a whole English title) may wrap */}
            <Bdi className={part.length <= 24 ? 'whitespace-nowrap' : ''}>{part}</Bdi>
            {tail}
          </Fragment>
        );
      })}
    </>
  );
}

const MARK = (i: number) => `${i}`;

/**
 * Fills a copy template (a function of strings) with data-derived arguments, each one isolated with `BidiText`:
 * `<Interp tpl={t.plan.shop} args={[shopName]} />` gives «مغازهٔ «<bdi>Aria</bdi>»». The template must insert its
 * arguments verbatim.
 */
export function Interp({ tpl, args }: { tpl: (...a: string[]) => string; args: string[] }) {
  const out = tpl(...args.map((_, i) => MARK(i)));
  const pieces = out.split(/(\d+)/);
  return (
    <>
      {pieces.map((p, i) => (i % 2 === 1 ? <BidiText key={i} text={args[Number(p)] ?? ''} /> : <Fragment key={i}>{p}</Fragment>))}
    </>
  );
}
