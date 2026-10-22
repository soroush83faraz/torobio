/**
 * D7a: «از فروشنده بپرس» is phrased for the item bought at THAT seller. A camera's seller is never asked
 * «آیا این ضبط‌کننده …»; every ordered role pair has its own sentence.
 */
import { describe, expect, it } from 'vitest';
import { askCompatWith, COMPAT_ROLES, type CompatRole } from '../../copy/fa';
import { req } from '../../requirement/__tests__/fixtures';
import type { ProductAttrs, Requirement } from '../../types/index';
import { evaluateCompat } from '../index';

const NOUN: Record<CompatRole, string> = { camera: 'دوربین', recorder: 'ضبط‌کننده', hdd: 'هارد', adapter: 'آداپتور' };
const ch = (item: Requirement, attrs: ProductAttrs | null) => ({ item, attrs });

describe('askCompatWith: every ordered role pair', () => {
  for (const buying of COMPAT_ROLES)
    for (const other of COMPAT_ROLES) {
      if (buying === other) continue;
      it(`${buying} seller about the ${other}`, () => {
        const withDesc = askCompatWith(buying, other, 'X');
        expect(withDesc.startsWith(`آیا این ${NOUN[buying]} با ${NOUN[other]}`)).toBe(true);
        expect(withDesc).toContain('که می‌خرم (X) سازگار است؟');
        // the item bought here is the subject; the other item never is
        expect(withDesc).not.toContain(`این ${NOUN[other]}`);
        expect(askCompatWith(buying, other)).not.toContain('()');
      });
    }
  it('all twelve sentences differ', () => {
    const all = COMPAT_ROLES.flatMap((b) => COMPAT_ROLES.filter((o) => o !== b).map((o) => askCompatWith(b, o)));
    expect(new Set(all).size).toBe(12);
  });
  it('the camera / recorder example', () => {
    expect(askCompatWith('camera', 'recorder', 'DVR')).toBe('آیا این دوربین با ضبط‌کننده‌ای که می‌خرم (DVR) سازگار است؟');
    expect(askCompatWith('recorder', 'camera', 'HDCVI')).toBe('آیا این ضبط‌کننده با دوربین‌هایی که می‌خرم (HDCVI) سازگار است؟');
  });
});

describe('rule findings carry per-seller wording', () => {
  const cam = req('cam', '۴ دوربین', [], { kind: 'camera', qty: 4, qtyStated: true });
  const rec = req('rec', 'ضبط‌کننده', [], { kind: 'recorder' });
  const hdd = req('hdd', 'هارد', [], { kind: 'hdd' });
  const adp = req('adp', 'آداپتور', [], { kind: 'adapter' });
  const fs = evaluateCompat([
    ch(cam, { camera_signal: 'hdcvi' }),
    ch(rec, { recorder_kind: 'dvr', channels: 4 }),
    ch(hdd, { capacity_tb: 2 }),
    ch(adp, { voltage_v: 12, current_a: 0.5 }),
  ]);
  const role: Record<string, CompatRole> = { cam: 'camera', rec: 'recorder', hdd: 'hdd', adp: 'adapter' };
  it('each per-seller question names the item bought at that seller', () => {
    let n = 0;
    for (const f of fs)
      for (const [id, text] of Object.entries(f.askSellerByItem ?? {})) {
        n++;
        expect(text, `${f.ruleId} @ ${id}`).toMatch(new RegExp(`(^|\\s)(آیا )?این ${NOUN[role[id]!]}|^هر ${NOUN[role[id]!]}|^جمع جریان`));
        for (const other of Object.values(NOUN)) if (other !== NOUN[role[id]!]) expect(text.startsWith(`آیا این ${other}`)).toBe(false);
      }
    expect(n).toBeGreaterThanOrEqual(8);
  });
  it('the camera seller of an HDCVI camera next to a DVR', () => {
    const sig = fs.find((f) => f.ruleId === 'camera_recorder_signal')!;
    expect(sig.askSellerByItem!.cam).toMatch(/^آیا این دوربین با ضبط‌کننده‌ای که می‌خرم \(.*DVR.*\) سازگار است؟$/);
    expect(sig.askSellerByItem!.rec).toMatch(/^آیا این ضبط‌کننده با دوربین‌هایی که می‌خرم \(.*HDCVI.*\) سازگار است؟$/);
  });
});
