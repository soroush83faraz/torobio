/** The parser's listing-condition reading of the user's own words (no database needed). */
import { describe, expect, it } from 'vitest';
import { conditionOf } from '../src/parse/parse.js';

describe('conditionOf (user text -> accepted listing conditions)', () => {
  it('used words ask for used listings', () => {
    expect(conditionOf('موبایل استوک', 'phone')).toBe('used');
    expect(conditionOf('لپ تاپ ایسوس کارکرده', null)).toBe('used');
    expect(conditionOf('گوشی دست دوم سامسونگ', 'phone')).toBe('used');
    expect(conditionOf('هارد ریفر ۲ ترابایت', 'hdd')).toBe('used');
  });
  it('copy words ask for copies only where copies are a listing fact', () => {
    expect(conditionOf('هندزفری کپی', 'headphones')).toBe('replica');
    // «کاغذ کپی» is photocopy paper: the generic path never reads «کپی» as a replica
    expect(conditionOf('کاغذ کپی', null)).toBeUndefined();
  });
  it('«نو یا کارکرده» accepts both', () => {
    expect(conditionOf('لپ تاپ نو یا کارکرده', null)).toBe('any');
    expect(conditionOf('گوشی استوک یا نو', 'phone')).toBe('any');
  });
  it('nothing stated = default (new only)', () => {
    expect(conditionOf('لپ تاپ ایسوس', null)).toBeUndefined();
    expect(conditionOf('گوشی آکبند', 'phone')).toBeUndefined();
  });
});
