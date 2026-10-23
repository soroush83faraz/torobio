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
    ['ink on canvas', '#1E1A15', '#F8F3EB'],
    ['ink-soft on canvas', '#5A5146', '#F8F3EB'],
    ['ink-soft on sunken', '#5A5146', '#F0E8DB'],
    ['ink-soft on surface', '#5A5146', '#FFFFFF'],
    ['white on accent', '#FFFFFF', '#0A6B6B'],
    ['accent-ink on accent-soft', '#064848', '#DDEFEC'],
    ['accent-ink on canvas', '#064848', '#F8F3EB'],
    ['amber/saffron-ink on saffron-soft', '#6B4300', '#FCEFD0'],
    ['danger on danger-soft', '#9B2F28', '#FBE9E7'],
    ['danger on surface', '#9B2F28', '#FFFFFF'],
    ['ink on saffron-soft', '#1E1A15', '#FCEFD0'],
    ['ink on saffron (hero send button)', '#1E1A15', '#E8A317'],
    ['terracotta-ink on terracotta-soft', '#8A3818', '#F8E5DA'],
    ['night-ink on night (hero)', '#F7EFE2', '#0B2422'],
    ['night-soft on night-3 (lightest hero gradient stop)', '#BCD2CD', '#165A55'],
    ['white on night-2 (floating action)', '#FFFFFF', '#0F3A37'],
    ['saffron-bright on night (toast action)', '#F4C155', '#0B2422'],
  ];
  for (const [name, fg, bg] of pairs) {
    it(`${name} >= 4.5:1`, () => expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5));
  }
  it('non-text outline (line-strong on canvas) >= 3:1', () => expect(ratio('#8C8172', '#F8F3EB')).toBeGreaterThanOrEqual(3));
});
