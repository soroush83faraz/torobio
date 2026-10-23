import { describe, expect, it } from 'vitest';
import {
  assumedConstraintText,
  budgetBandLabel,
  compatCopy,
  COMPAT_STATUS_LABEL,
  describeConstraintEval,
  guardConstraintText,
  MISSING_GROUP,
  MISSING_GROUP_LABEL,
  noMatchCopy,
  Q_ADAPTER_FOR_CAMERAS,
  faNum,
  formatAttrValue,
  formatMeters,
  formatTomanCompact,
  formatTomanExact,
  ITEM_STATE_LABEL,
  ltr,
  planCopy,
  questionOptionHint,
  questionWhy,
} from '../fa';
import { ATTR_KEYS, ATTR_SCHEMA } from '../../types/index';

describe('question copy', () => {
  it('option hints say how many models an answer keeps and from what price', () => {
    expect(questionOptionHint(187, 1_200_000)).toBe('۱۸۷ مدل · از ۱٫۲ میلیون');
    expect(questionOptionHint(3, 250_000)).toBe('۳ مدل · از ۲۵۰ هزار');
    expect(questionOptionHint(1_242)).toBe('۱٬۲۴۲ مدل');
  });
  it('every facet the engine may ask has a one-line why; the budget line quotes the real range', () => {
    for (const k of ATTR_KEYS) {
      const s = ATTR_SCHEMA[k];
      if (!s.askable || s.kind === 'string_list' || k === 'sale_unit') continue; // sale unit: the compat rule's line
      const why = questionWhy(k);
      expect(why, k).toBeTruthy();
      expect(why!.includes('\n'), k).toBe(false);
    }
    expect(questionWhy('budget', { min: 1_200_000, max: 13_200_000 })).toBe(
      'قیمت این مدل‌ها ۱٫۲ تا ۱۳٫۲ میلیون تومان است؛ بازه‌ها از همین قیمت‌ها ساخته شده‌اند.',
    );
  });
});

describe('Persian formatting', () => {
  it('digits, separators, compact toman', () => {
    expect(faNum(3_200_000)).toBe('۳٬۲۰۰٬۰۰۰');
    expect(formatTomanExact(3_200_000)).toBe('۳٬۲۰۰٬۰۰۰ تومان');
    expect(formatTomanCompact(18_400_000)).toBe('۱۸٫۴ میلیون تومان');
    expect(formatTomanCompact(800_000)).toBe('۸۰۰ هزار تومان');
    expect(formatTomanCompact(2_000_000_000)).toBe('۲ میلیارد تومان');
    expect(formatMeters(87)).toBe('حدود ۹۰ متر');
    expect(formatMeters(1240)).toBe('حدود ۱٫۲ کیلومتر');
  });
  it('isolates Latin runs', () => {
    expect(ltr('NVR')).toBe('⁦NVR⁩');
    expect(formatAttrValue('recorder_kind', 'nvr')).toBe(ltr('NVR'));
    expect(formatAttrValue('resolution_mp', 2)).toBe('۲ مگاپیکسل');
    expect(formatAttrValue('capacity_tb', 0.5)).toBe('۵۰۰ گیگابایت');
  });
  it('labels from the spec', () => {
    expect(ITEM_STATE_LABEL).toEqual({
      exact_model: 'مدل مشخص',
      suggested: 'پیشنهاد',
      alternative: 'جایگزین',
      needs_info: 'نیاز به اطلاعات',
      not_found: 'پیدا نشد',
      price_unknown: 'قیمت ثبت نشده',
    });
    expect(COMPAT_STATUS_LABEL.listing_stated).toBe('طبق عنوان آگهی');
    expect(COMPAT_STATUS_LABEL.assumed).toBe('فرض عمومی؛ تأیید نشده');
    expect(COMPAT_STATUS_LABEL.unknown).toBe('نامشخص');
  });
  it('totals and budget bands', () => {
    expect(planCopy.totalComplete(5, 18_400_000)).toBe('جمع ۵ مورد: ۱۸٫۴ میلیون تومان');
    expect(planCopy.totalPartial(3, 5, 11_200_000)).toBe('فقط ۳ از ۵ مورد: ۱۱٫۲ میلیون تومان');
    expect(planCopy.missingLine(['ضبط‌کننده', 'آداپتور'])).toBe('بدون قیمت یا انتخاب: ضبط‌کننده، آداپتور');
    expect(budgetBandLabel(undefined, 8_000_000)).toBe('تا ۸ میلیون');
    expect(budgetBandLabel(8_000_000, 15_000_000)).toBe('۸ تا ۱۵ میلیون');
    expect(budgetBandLabel(800_000, 1_500_000)).toBe('۸۰۰ هزار تا ۱٫۵ میلیون');
    expect(budgetBandLabel(15_000_000, undefined)).toBe('بیشتر از ۱۵ میلیون');
  });
  it('partial wording never uses a superlative', () => {
    expect(planCopy.partial(3, 5, 2)).not.toMatch(/ترین/);
  });
});

describe('G1a copy: missing lines per reason, the 12 V assumption, no-match sentences', () => {
  it('missing items are grouped by why: «پیدا نشد» / «منتظر انتخاب» / «قیمت ثبت نشده», never one mixed line', () => {
    const line = planCopy.missingLines([
      { label: 'آداپتور', reason: 'needs_info' },
      { label: 'لپ‌تاپ ایسوس', reason: 'not_found' },
      { label: 'پروژکتور', reason: 'price_unknown' },
      { label: 'قاب', reason: 'no_choice' },
      { label: 'سیم', reason: 'no_offer' },
    ]);
    expect(line).toBe('پیدا نشد: لپ‌تاپ ایسوس · منتظر انتخاب: آداپتور، قاب · قیمت ثبت نشده: پروژکتور، سیم');
    expect(line).not.toContain('بدون قیمت یا انتخاب');
    expect(planCopy.missingLines([{ label: 'الف', reason: 'not_found' }])).toBe('پیدا نشد: الف');
    expect(planCopy.missingLines([{ label: 'ب', reason: 'stop_limit' }, { label: 'ج', reason: 'closed' }])).toBe(
      'فروشنده‌ها در این زمان بسته‌اند: ج · در این برنامه جا نشد: ب',
    );
    for (const r of ['needs_info', 'not_found', 'price_unknown', 'no_choice', 'closed', 'excluded', 'no_offer', 'stop_limit'] as const)
      expect(MISSING_GROUP_LABEL[MISSING_GROUP[r]]).toBeTruthy();
  });
  it('the 12 V rule is always worded as a general assumption', () => {
    const c = { attr: 'voltage_v', op: 'eq', value: 12, source: 'compat', ruleId: 'camera_adapter_12v' } as const;
    expect(assumedConstraintText(c, 'دوربین')).toBe('۱۲ ولت (فرض عمومی برای «دوربین»؛ تأیید نشده)');
    expect(describeConstraintEval({ constraint: c, result: 'fail', actual: 4.2 })).toBe(
      'ولتاژ: ۴٫۲ ولت به‌جای ۱۲ ولت (فرض عمومی: دوربین‌ها معمولاً ۱۲ ولت می‌خواهند؛ تأیید نشده)',
    );
    expect(describeConstraintEval({ constraint: c, result: 'unknown' })).toContain('فرض عمومی');
    expect(compatCopy.adapterUserVoltage(5)).toContain('فرض عمومی');
    expect(Q_ADAPTER_FOR_CAMERAS.text).toContain('فرض عمومی؛ تأیید نشده');
    expect(guardConstraintText({ attr: 'recorder_kind', op: 'in', values: ['xvr', 'dvr'], source: 'compat' }, 'دوربین')).toBe(
      `${ltr('XVR')} یا ${ltr('DVR')} (برای جور شدن با «دوربین» در برنامه)`,
    );
  });
  it('no-match sentences carry the data numbers', () => {
    expect(noMatchCopy.budget(undefined, 50_000_000, 100_600_000)).toBe('هیچ مدلی با بودجهٔ ۵۰ میلیون پیدا نشد؛ ارزان‌ترین مدل ۱۰۰٫۶ میلیون تومان است');
    expect(noMatchCopy.budget(8_000_000, 15_000_000, null)).toBe('هیچ مدلی با بودجهٔ ۸ تا ۱۵ میلیون پیدا نشد');
    expect(noMatchCopy.conditionUsed(2)).toBe('هیچ آگهی کارکرده یا استوکی پیدا نشد؛ ۲ مدل نو مطابق بقیهٔ خواسته‌ات هست');
    expect(noMatchCopy.relaxBudget).toBe('بودجه را بردار');
  });
});
