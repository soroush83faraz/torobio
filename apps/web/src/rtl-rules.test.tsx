import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BidiText } from './components/Bdi';
import { t } from './copy/fa';

const SRC = dirname(fileURLToPath(import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const tsxFiles = walk(SRC).filter((f) => /\.(tsx|ts|css)$/.test(f) && !/\.test\./.test(f) && !/\/mock\//.test(f.replace(/\\/g, '/')));

describe('RTL rules (logical properties only)', () => {
  it('uses no physical Tailwind utilities', () => {
    const bad: string[] = [];
    const physical = /^(?:-?(?:ml|mr|pl|pr|left|right)-|text-(?:left|right)$|rounded-(?:l|r|tl|tr|bl|br)(?:-|$)|border-(?:l|r)(?:-|$)|space-x-|divide-x)/;
    for (const f of tsxFiles.filter((x) => x.endsWith('.tsx'))) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
        const text = (m[1] ?? m[2] ?? '').replace(/\$\{[^}]*\}/g, ' ');
        for (const tok of text.split(/\s+/)) {
          const base = tok.split(':').pop() ?? '';
          if (physical.test(base)) bad.push(`${f}: ${tok}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('uses no physical CSS properties in styles', () => {
    const bad: string[] = [];
    for (const f of tsxFiles) {
      const src = readFileSync(f, 'utf8');
      if (/\b(?:margin|padding)-(?:left|right)\b|\b(?:marginLeft|marginRight|paddingLeft|paddingRight)\b|(?:^|[\s{;])(?:left|right)\s*:/m.test(src)) bad.push(f);
    }
    expect(bad).toEqual([]);
  });
});

describe('copy', () => {
  it('has no Latin letters in user-facing strings (the home example input is the only exception)', () => {
    const offenders: string[] = [];
    const visit = (node: unknown, path: string) => {
      if (typeof node === 'string') {
        if (/[A-Za-z]/.test(node) && path !== 'home.examplePhoneText') offenders.push(`${path}: ${node}`);
      } else if (Array.isArray(node)) node.forEach((x, i) => visit(x, `${path}[${i}]`));
      else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) visit(v, path ? `${path}.${k}` : k);
    };
    visit(t, '');
    expect(offenders).toEqual([]);
  });

  it('never shows phone-number words or age-based wording', () => {
    const all = JSON.stringify(t);
    expect(all).not.toMatch(/تلفن|شماره تماس|موبایل شما/);
    expect(all).not.toMatch(/قدیمی|منقضی|کهنه/);
  });

  it('page title and html shell are Persian', () => {
    const html = readFileSync(join(SRC, '..', 'index.html'), 'utf8');
    expect(html).toMatch(/<html lang="fa" dir="rtl">/);
    expect(html).toMatch(/<title>همراه‌بازار<\/title>/);
  });
});

describe('bidi isolation', () => {
  it('wraps each Latin run (model codes, brands) in an LTR isolate', () => {
    const html = renderToStaticMarkup(<BidiText text="دوربین داهوا مدل HAC-HDW1200CLQP با ۴ کانال" />);
    expect(html).toMatch(/<bdi dir="ltr" class="font-medium whitespace-nowrap">HAC-HDW1200CLQP<\/bdi>/);
  });
  it('keeps «AHD / HDCVI / TVI» as one run so it never reorders', () => {
    const html = renderToStaticMarkup(<BidiText text="AHD / HDCVI / TVI" />);
    expect(html.match(/<bdi/g)).toHaveLength(1);
    expect(html).toContain('AHD / HDCVI / TVI');
  });
  it('keeps «Galaxy A56» together and leaves Persian digits alone', () => {
    const html = renderToStaticMarkup(<BidiText text="گوشی Galaxy A56 ۲۵۶ گیگ" />);
    expect(html).toContain('>Galaxy A56</bdi>');
    expect(html).toContain('۲۵۶ گیگ');
  });
});

/** WCAG contrast for the token pairs actually used for text. */
function lum(hex: string) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

describe('WCAG AA contrast of design tokens', () => {
  // keep in sync with tailwind.config.js
  const pairs: [string, string, string][] = [
    ['ink on canvas', '#1B1B1F', '#FBFBFB'],
    ['ink-soft on canvas', '#5B5B66', '#FBFBFB'],
    ['ink-soft on sunken', '#5B5B66', '#F2F2F4'],
    ['ink-soft on surface', '#5B5B66', '#FFFFFF'],
    ['ink-soft on line (disabled primary button)', '#5B5B66', '#E7E7EA'],
    ['placeholder on surface', '#6B6B75', '#FFFFFF'],
    ['white on accent (primary button, tab pill, send)', '#FFFFFF', '#D91E2B'],
    ['white on accent-strong (hover)', '#FFFFFF', '#B71822'],
    ['accent on canvas (red text)', '#D91E2B', '#FBFBFB'],
    ['accent on surface (red text)', '#D91E2B', '#FFFFFF'],
    ['accent-ink on accent-soft', '#7A0F16', '#FDECEE'],
    ['accent-ink on canvas', '#7A0F16', '#FBFBFB'],
    ['white on good-strong (exact badge, recommended pin, one-stop badge)', '#FFFFFF', '#14703B'],
    ['good-ink on good-soft', '#0E4A27', '#E3F4EA'],
    ['good-strong on surface (complete total)', '#14703B', '#FFFFFF'],
    ['good-strong on good-soft', '#14703B', '#E3F4EA'],
    ['amber-ink on amber-soft', '#5E4600', '#FBF3DC'],
    ['ink on amber-soft', '#1B1B1F', '#FBF3DC'],
    ['danger on danger-soft', '#A3121B', '#FBE9EA'],
    ['danger on surface', '#A3121B', '#FFFFFF'],
    ['night-ink on night (hero)', '#FFFFFF', '#7E0F18'],
    ['night-ink on night-3 (lightest hero gradient stop)', '#FFFFFF', '#B71822'],
    ['night-soft on night-3 (lightest hero gradient stop)', '#FFD6D9', '#B71822'],
    ['coal-ink on coal (toast, dock)', '#FFFFFF', '#1B1B1F'],
    ['coal-soft on coal-2 (lightest charcoal stop)', '#C8C8CE', '#2B2B32'],
    ['good-bright on coal-2 (green news on charcoal)', '#6BD49A', '#2B2B32'],
  ];
  for (const [name, fg, bg] of pairs) {
    it(`${name} >= 4.5:1`, () => expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5));
  }
  // non-text: control outlines, icons, focus rings, check-marks
  const shapes: [string, string, string][] = [
    ['line-strong on canvas (input/chip outline)', '#8A8A93', '#FBFBFB'],
    ['line-strong on surface', '#8A8A93', '#FFFFFF'],
    ['line-strong on sunken', '#8A8A93', '#F2F2F4'],
    ['white check on good (checked box)', '#FFFFFF', '#1B8A4B'],
    ['good on surface (dots, unchecked hover)', '#1B8A4B', '#FFFFFF'],
    ['focus ring (ink) on canvas', '#1B1B1F', '#FBFBFB'],
    ['focus ring (white) on night-3', '#FFFFFF', '#B71822'],
    ['partial ring arc on surface', '#B8890A', '#FFFFFF'],
  ];
  for (const [name, fg, bg] of shapes) {
    it(`${name} >= 3:1`, () => expect(ratio(fg, bg)).toBeGreaterThanOrEqual(3));
  }
});
