// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { mockParse } from '../api/mock/engine';
import { STORAGE_KEY, usePlans } from '../store/plans';
import { decodeShare, encodeShare } from '../store/share';
import { sanitizeText as coreSanitizeText } from '@app/core/src/normalize/sanitize';
import { sanitizeDeep, sanitizeText } from './sanitize';

const BIDI = ['\u200E', '\u200F', '\u061C', '\u202A', '\u202B', '\u202C', '\u202D', '\u202E', '\u2066', '\u2067', '\u2068', '\u2069'];
const hasBidi = (s: string) => BIDI.some((c) => s.includes(c));

describe('sanitizeText', () => {
  it('strips bidi embeddings / overrides / isolates', () => {
    expect(sanitizeText(`\u202Eگوشی\u202C \u2066A56\u2069`)).toBe('گوشی A56');
    for (const c of BIDI) expect(sanitizeText(`a${c}b`)).toBe('ab');
  });
  it('strips the implicit direction marks LRM, RLM and ALM (and zero-width space) too', () => {
    expect(sanitizeText('برنامه\u200F ۱\u200E')).toBe('برنامه ۱');
    expect(sanitizeText('نام\u061Cمن')).toBe('ناممن');
    expect(sanitizeText('a\u200Bb\u2060c\uFEFFd')).toBe('abcd');
    for (const c of ['\u200E', '\u200F', '\u061C']) expect(sanitizeText(`x${c}y`)).toBe('xy');
  });
  it('keeps ZWNJ next to letters when marks around it are removed', () => {
    expect(sanitizeText('ضبط\u200F\u200Cکننده\u200E')).toBe('ضبط\u200Cکننده');
  });
  it('is the same implementation the server uses (one-line mode here)', () => {
    expect(sanitizeText('a\nb')).toBe('a b');
    expect(coreSanitizeText('a\nb')).toBe('a\nb'); // multi-line input keeps its breaks on the server
    expect(coreSanitizeText('a\nb', { multiline: false })).toBe(sanitizeText('a\nb'));
    const dirty = '\u202Eگوشی\u200F \u2066A56\u2069\u0007 ضبط\u200Cکننده';
    expect(sanitizeText(dirty)).toBe(coreSanitizeText(dirty, { multiline: false }));
  });
  it('turns control characters into a space (the shared rule) but keeps ZWNJ and ZWJ', () => {
    expect(sanitizeText('ضبط\u200Cکننده\u0000\u0007\u001B\u007F\u0085').trim()).toBe('ضبط\u200Cکننده');
    expect(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/.test(sanitizeText('a\u0000b\u0085c'))).toBe(false);
    expect(sanitizeText('a\u200Db')).toBe('a\u200Db');
  });
  it('turns line breaks and tabs into a space', () => {
    expect(sanitizeText('دوربین\nهارد\t۲\r\nتا')).toBe('دوربین هارد ۲ تا');
    expect(sanitizeText('a\u2028b\u2029c')).toBe('a b c');
  });
  it('leaves ordinary Persian / Latin text untouched', () => {
    const s = 'گوشی سامسونگ Galaxy A56 زیر ۵۰ میلیون، 4.2V';
    expect(sanitizeText(s)).toBe(s);
  });
  it('cleans nested values', () => {
    expect(sanitizeDeep({ a: ['\u202Ex'], b: { c: 'y\u0000', n: 3 } })).toEqual({ a: ['x'], b: { c: 'y ', n: 3 } });
  });
});

describe('sanitising at every boundary', () => {
  beforeEach(() => {
    localStorage.clear();
    usePlans.setState({ plans: {}, progress: {}, lastSavedAt: null });
  });

  it('a new plan stores clean text', () => {
    const { items } = mockParse('گوشی \u202Eسامسونگ');
    const id = usePlans.getState().create('نام\u202E\u0000 برنامه', items);
    const p = usePlans.getState().plans[id]!;
    expect(p.name.replace(/ +/g, ' ')).toBe('نام برنامه');
    expect(hasBidi(p.requirements[0]!.text)).toBe(false);
  });

  it('rename strips bidi controls', () => {
    const { items } = mockParse('هارد');
    const id = usePlans.getState().create('x', items);
    usePlans.getState().rename(id, '\u2067نام جدید\u2069');
    expect(usePlans.getState().plans[id]!.name).toBe('نام جدید');
  });

  it('a share link is clean both ways: sent and imported', () => {
    const { items } = mockParse('هارد');
    const id = usePlans.getState().create('x', items);
    // a hostile plan written straight into the store (old state) is cleaned when the link is built
    usePlans.setState((s) => ({ plans: { ...s.plans, [id]: { ...s.plans[id]!, name: 'a\u202Eb', requirements: [{ ...s.plans[id]!.requirements[0]!, text: 'ه\u202Eارد\u0000' }] } } }));
    const out = decodeShare(encodeShare(usePlans.getState().plans[id]!))!;
    expect(out.name).toBe('ab');
    expect(out.requirements[0]!.text.trim()).toBe('هارد');

    // and a link crafted by someone else is cleaned on import
    const evil = { v: 1, n: '\u202Efdp\u202C', s: { requirements: [{ id: 'i1', text: 'گو\u2066شی\u2069\u0001', qty: 1 }] } };
    const { compressToEncodedURIComponent } = require('lz-string') as typeof import('lz-string');
    const imported = decodeShare(compressToEncodedURIComponent(JSON.stringify(evil)))!;
    expect(imported.name).toBe('fdp');
    expect(imported.requirements[0]!.text.trim()).toBe('گوشی');
  });

  it('a share link with LRM / RLM / ALM: the imported plan name, requirement text and localStorage are clean', () => {
    const evil = {
      v: 1,
      n: 'پروژه\u200F ۱\u200E\u061C',
      s: { requirements: [{ id: 'i1', text: 'گوشی\u200F A56\u200E', qty: 1 }], answers: { i1: { chip: 'x\u200F' } } },
    };
    const { compressToEncodedURIComponent } = require('lz-string') as typeof import('lz-string');
    const decoded = decodeShare(compressToEncodedURIComponent(JSON.stringify(evil)))!;
    expect(decoded.name).toBe('پروژه ۱');
    expect(decoded.requirements[0]!.text).toBe('گوشی A56');
    const id = usePlans.getState().importCopy(decoded);
    const p = usePlans.getState().plans[id]!;
    expect(p.name).toBe('پروژه ۱');
    expect(p.requirements[0]!.text).toBe('گوشی A56');
    const stored = localStorage.getItem(STORAGE_KEY)!;
    for (const c of ['\u200E', '\u200F', '\u061C']) expect(stored.includes(c), `localStorage has U+${c.charCodeAt(0).toString(16)}`).toBe(false);
    expect(JSON.stringify(p.answers)).not.toContain('\u200F');
  });

  it('text read back from old storage is cleaned on rehydrate', async () => {
    const { items } = mockParse('هارد');
    const id = usePlans.getState().create('x', items);
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    raw.state.plans[id].name = 'قدیمی\u202E';
    raw.state.plans[id].requirements[0].text = 'ه\u202Eارد\u0007';
    usePlans.setState({ plans: {} }); // (this also rewrites the storage, so put the old payload back afterwards)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
    await usePlans.persist.rehydrate();
    const p = usePlans.getState().plans[id]!;
    expect(p.name).toBe('قدیمی');
    expect(p.requirements[0]!.text.trim()).toBe('هارد');
  });
});
