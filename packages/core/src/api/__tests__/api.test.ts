import { describe, expect, it } from 'vitest';
import { decodeOptionId, encodeOptionId, toEngineConstraint } from '../answers';
import { RequirementStateSchema } from '../dto';
import { kindForCategoryName, kindForCategoryNames } from '../kinds';
import { isVisitActive, toEngineVisit, weekdayOfIsoDate } from '../visit';
import { apiCopy, displayDeviceModel } from '../copy';

describe('stateless answer option ids', () => {
  it('round-trips constraints and budgets', () => {
    const cases = [
      { constraint: { attr: 'resolution_mp', op: 'eq', value: 2, source: 'answer' } },
      { constraint: { attr: 'brand', op: 'eq', value: 'fa:نوید', source: 'answer' } },
      { constraint: { attr: 'recorder_kind', op: 'in', values: ['xvr', 'dvr'], source: 'answer' } },
      { constraint: { attr: 'fits_models', op: 'contains', value: 'galaxy a56', source: 'answer' } },
      { constraint: { attr: 'hdd_surveillance', op: 'eq', value: true, source: 'answer' } },
    ] as const;
    for (const apply of cases) {
      const id = encodeOptionId(apply)!;
      expect(decodeOptionId(id)).toEqual({ kind: 'constraint', constraint: apply.constraint });
    }
    expect(decodeOptionId(encodeOptionId({ budget: { min: 1_000_001, max: 3_000_000 } })!)).toEqual({ kind: 'budget', budget: { min: 1_000_001, max: 3_000_000 } });
    expect(decodeOptionId(encodeOptionId({ budget: { max: 500_000 } })!)).toEqual({ kind: 'budget', budget: { max: 500_000 } });
    expect(decodeOptionId('any')).toEqual({ kind: 'skip' });
  });

  it('rejects anything outside the closed schema', () => {
    for (const bad of [
      'c~eq~recorder_kind~"vcr"', // not an enum value
      'c~eq~not_an_attr~1',
      'c~contains~brand~"x"', // contains only for string lists
      'c~gte~brand~3',
      'c~eq~resolution_mp~"2"', // wrong type
      'c~eq~resolution_mp~1e400',
      'c~in~recorder_kind~[{"a":1}]',
      'c~eq~brand~not json',
      'b~5~1', // min > max
      'b~~',
      'b~-1~5',
      'x',
      '',
    ]) {
      expect(decodeOptionId(bad), bad).toBeNull();
    }
  });

  it('chip constraints are validated the same way', () => {
    expect(toEngineConstraint({ attr: 'voltage_v', op: 'eq', value: 12 }, 'user')).toEqual({ attr: 'voltage_v', op: 'eq', value: 12, source: 'user' });
    expect(toEngineConstraint({ attr: 'sale_unit', op: 'eq', value: 'roll100' }, 'user')).toBeNull();
    expect(toEngineConstraint({ attr: 'camera_signal', op: 'in', values: ['ip', 'bogus'] }, 'user')).toBeNull();
  });
});

describe('request schema limits', () => {
  const ok = { requirements: [], answers: {}, settled: {}, pins: {}, shopPins: {}, excludedShops: {}, variant: null, visit: { day: 'today', window: 'any' } };
  it('accepts the web store shape and refuses oversized input', () => {
    expect(RequirementStateSchema.safeParse(ok).success).toBe(true);
    expect(RequirementStateSchema.safeParse({ ...ok, visit: { day: 'date', date: '2026/10/23', window: 'any' } }).success).toBe(false);
    const big = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, true]));
    expect(RequirementStateSchema.safeParse({ ...ok, settled: big }).success).toBe(false);
  });
});

describe('category -> kind (one table)', () => {
  it('maps the demo categories and leaves everything else as other', () => {
    expect(kindForCategoryName('دوربین مدار بسته')).toBe('camera');
    expect(kindForCategoryName('ضبط کننده ویدیویی دوربین‌های نظارتی و امنیتی')).toBe('recorder');
    expect(kindForCategoryName('هارد دیسک اینترنال')).toBe('hdd');
    expect(kindForCategoryName('حافظه SSD')).toBe('other');
    expect(kindForCategoryName('منبع تغذیه سوییچینگ')).toBe('adapter');
    expect(kindForCategoryName('سیم و کابل برق ساختمان')).toBe('wire');
    expect(kindForCategoryName('گوشی موبایل')).toBe('phone');
    expect(kindForCategoryName('کیف و کاور گوشی')).toBe('phone_case');
    expect(kindForCategoryName('محافظ صفحه نمایش گوشی')).toBe('screen_protector');
    expect(kindForCategoryName('قاب، شاسی و درب گوشی')).toBe('other');
    expect(kindForCategoryName('لپ تاپ و نوت بوک')).toBe('other');
    expect(kindForCategoryNames(['کلید و پریز', 'آداپتور برق'])).toBe('adapter');
  });
});

describe('visit time', () => {
  const now = new Date('2026-10-21T22:30:00+03:30'); // Wednesday night in Tehran
  it('today + any time = no filter; other choices map to weekday and minute (Tehran)', () => {
    expect(isVisitActive({ day: 'today', window: 'any' })).toBe(false);
    expect(toEngineVisit({ day: 'today', window: 'any' }, now)).toBeUndefined();
    expect(toEngineVisit({ day: 'today', window: 'evening' }, now)).toEqual({ day: 'wed', minute: 1080 });
    expect(toEngineVisit({ day: 'tomorrow', window: 'any' }, now)).toEqual({ day: 'thu' });
    expect(toEngineVisit({ day: 'date', date: '2026-10-23', window: 'exact', time: '13:00' }, now)).toEqual({ day: 'fri', minute: 780 });
    expect(toEngineVisit({ day: 'date', date: '2026-10-24', window: 'exact', time: '19:30' }, now)).toEqual({ day: 'sat', minute: 1170 });
    expect(weekdayOfIsoDate('2026-02-30')).toBeNull();
  });
});

describe('api copy', () => {
  it('formats device models, hours and warranty from data only', () => {
    expect(displayDeviceModel('galaxy a56 5g')).toBe('Galaxy A56 5G');
    expect(displayDeviceModel('iphone 15 pro max')).toBe('iPhone 15 Pro Max');
    expect(apiCopy.hoursText({ sat: [[600, 1170]] }, 'sat', 'شنبه')).toBe('ساعت کار شنبه: ۱۰ تا ۱۹:۳۰');
    expect(apiCopy.hoursText({ sat: [[600, 1170]], fri: [] }, 'fri', 'جمعه')).toBe('جمعه تعطیل است');
    expect(apiCopy.hoursText({ sat: [[600, 1170]] }, 'fri', 'جمعه')).toBe('ساعت کار جمعه ثبت نشده');
    expect(apiCopy.hoursText(null, 'fri', 'جمعه')).toBe('ساعت کاری ثبت نشده');
    expect(apiCopy.warranty('company', 18)).toBe('گارانتی شرکتی · ۱۸ ماه');
    expect(apiCopy.floorLabel('-1')).toBe('طبقهٔ منفی ۱');
    expect(apiCopy.unitLabel('A41')).toContain('A41');
  });
});
