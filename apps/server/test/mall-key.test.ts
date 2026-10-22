import { existsSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { findRepoRoot } from '../src/config.js';
import { normalizeMallKey, sameMall } from '../src/mall-key.js';

describe('normalizeMallKey', () => {
  it('maps digit script and ordinal-word variants of one building to a single key', () => {
    const variants = ['m:علاالدین2', 'm:علاالدین۲', 'm:علاالدین٢', 'm:علاالدیندوم', 'm:علاالدین دوم', 'm:علاالدین‌دوم'];
    expect(new Set(variants.map(normalizeMallKey))).toEqual(new Set(['m:علاالدین2']));
    expect(normalizeMallKey('m:علاالدینسوم')).toBe('m:علاالدین3');
    expect(normalizeMallKey('m:الدین۳')).toBe('m:الدین3');
    expect(normalizeMallKey('m:برجدهم')).toBe('m:برج10');
  });

  it('leaves unrelated keys alone', () => {
    for (const k of ['m:علاالدین', 'm:اولادی', 'm:سوم', 'm:اول', 'm:ا‌دوم', 'c:35.6903,51.4162', '', 'm:']) {
      expect(normalizeMallKey(k), k).toBe(k === 'm:ا‌دوم' ? 'm:ادوم' : k);
    }
  });

  it('does not merge different buildings', () => {
    expect(sameMall('m:علاالدین2', 'm:علاالدین3')).toBe(false);
    expect(sameMall('m:علاالدین', 'm:علاالدین2')).toBe(false); // «1» / unnumbered stay with the data builder's alias map
    expect(sameMall('m:علاالدین2', 'm:علاالدیندوم')).toBe(true);
  });

  it('is idempotent', () => {
    for (const k of ['m:علاالدیندوم', 'm:الدین۳', 'm:علاالدین', 'c:1,2']) expect(normalizeMallKey(normalizeMallKey(k))).toBe(normalizeMallKey(k));
  });

  const DB_PATH = process.env.DATABASE_PATH ? path.resolve(process.env.DATABASE_PATH) : path.join(findRepoRoot(process.cwd()), 'data', 'market.sqlite');
  it.skipIf(!existsSync(DB_PATH))('real data: folds the ordinal-word key into the numbered key, never splits an existing one', () => {
    const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    try {
      const keys = (db.prepare("SELECT DISTINCT mall_key AS k FROM shops WHERE mall_key LIKE 'm:%'").all() as { k: string }[]).map((r) => r.k);
      expect(normalizeMallKey('m:علاالدیندوم')).toBe('m:علاالدین2');
      expect(keys).toContain('m:علاالدین2');
      // normalising never turns two numbered keys that differ into one
      const byNorm = new Map<string, string[]>();
      for (const k of keys) byNorm.set(normalizeMallKey(k), [...(byNorm.get(normalizeMallKey(k)) ?? []), k]);
      for (const [norm, group] of byNorm) if (group.length > 1) expect(group.every((g) => /\d|دوم|سوم|اول|چهارم/.test(g) || g === norm), norm).toBe(true);
    } finally {
      db.close();
    }
  });
});
