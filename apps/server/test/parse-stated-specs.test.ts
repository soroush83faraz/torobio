/**
 * Stated specs the parser used to read but drop (audit F3): power, power-bank capacity, wire strand, screen size.
 * They are now constraints, so a pick that contradicts them is never suggested. Fixture DB (and the real one when
 * present).
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { parseRequest } from '../src/parse/index.js';
import { buildParseFixture } from './parse-fixture.js';
import { cleanupTmp, tmpDir } from './helpers.js';

const realPath = process.env.DATABASE_PATH ? path.resolve(process.env.DATABASE_PATH) : loadConfig({ NODE_ENV: 'test' }).databasePath;
const dbs = [
  { name: 'fixture db', open: () => openDb(buildParseFixture(path.join(tmpDir(), 'fixture.sqlite'))) },
  ...(existsSync(realPath) ? [{ name: 'real db', open: () => openDb(realPath) }] : []),
];
afterAll(cleanupTmp);

describe.each(dbs)('stated specs on the $name', ({ open }) => {
  const db = open();
  const c = (text: string) => parseRequest(text, db).items[0]!.constraints;

  it('«N وات» on chargers and floodlights is a power constraint', () => {
    expect(c('شارژر ۲۵ وات')).toContainEqual({ attr: 'power_w', op: 'eq', value: 25, source: 'user' });
    expect(c('پروژکتور ال ای دی ۱۰۰ وات')).toContainEqual({ attr: 'power_w', op: 'eq', value: 100, source: 'user' });
  });
  it('power-bank capacity: «۲۰ هزار», «۱۰۰۰۰ میلی آمپر» and a bare «۲۰۰۰۰»', () => {
    for (const [t, v] of [['پاوربانک ۲۰ هزار', 20000], ['پاوربانک ۱۰۰۰۰ میلی آمپر', 10000], ['پاوربانک ۲۰۰۰۰', 20000]] as const) {
      expect(c(t)).toContainEqual({ attr: 'capacity_mah', op: 'eq', value: v, source: 'user' });
    }
    expect(c('پاوربانک').some((x) => x.attr === 'capacity_mah')).toBe(false);
  });
  it('«مفتولی» / «افشان» on wire is the strand', () => {
    expect(c('سیم ۴ مفتولی')).toContainEqual({ attr: 'wire_strand', op: 'eq', value: 'solid', source: 'user' });
    expect(c('سیم برق ۱.۵ افشان')).toContainEqual({ attr: 'wire_strand', op: 'eq', value: 'flexible', source: 'user' });
  });
  it('«N اینچ» is the screen size, in any category', () => {
    expect(c('تلویزیون سامسونگ ۵۵ اینچ')).toContainEqual({ attr: 'screen_inch', op: 'eq', value: 55, source: 'user' });
    expect(c('تلویزیون').some((x) => x.attr === 'screen_inch')).toBe(false);
  });
});
