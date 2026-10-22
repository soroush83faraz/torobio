import { describe, expect, it } from 'vitest';
import { mapMeta } from '../api/http';
import { t } from './fa';

describe('about sheet copy', () => {
  it('says plainly how many shops are in the data and how many have price listings', () => {
    const meta = mapMeta({ shopCount: 3792, snapshotDateFa: '۲۱ مهر ۱۴۰۵', productCount: 225903, counts: { shops: 6476, shops_with_offers: 3792, products: 225903 } });
    const line = t.about.counts(meta.shopsTotal, meta.shopCount, meta.productCount);
    expect(line).toContain('۶٬۴۷۶ مغازه در داده هست');
    expect(line).toContain('۳٬۷۹۲ مورد از آن‌ها فهرست قیمت دارند');
    expect(line).not.toMatch(/^۳٬۷۹۲ مغازه ·/);
  });
  it('falls back to the one number it has, labelled for what it is', () => {
    expect(t.about.counts(0, 3792, 10)).toBe('۳٬۷۹۲ مغازه با فهرست قیمت · ۱۰ کالا');
  });
  it("the date and the areas come from the meta; the organisers' 10% is attributed to them", () => {
    const b = t.about.bullets('۲۱ مهر ۱۴۰۵', 'فردوسی، بهارستان');
    expect(b[0]).toContain('۲۱ مهر ۱۴۰۵');
    expect(b[3]).toContain('طبق اعلام برگزارکننده');
    expect(b[3]).toContain('فردوسی، بهارستان');
    expect(t.about.bullets('', '')[0]).not.toMatch(/\d/);
  });
});
