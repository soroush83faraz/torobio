// @vitest-environment jsdom
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import type { ItemResolution, ModelOption, PlanResponse, Requirement, SellerOption, Stop, StopLine } from '../api/types';
import { MarketView } from '../screens/MarketView';
import { PlanView } from '../screens/PlanView';
import { ModelRow, SellerRow } from '../sheets/OptionsSheet';
import { SellerSheet } from '../sheets/SellerSheet';
import { blankPlan } from '../store/plans';
import { BidiText, Interp } from './Bdi';
import { CompatRow } from './CompatChip';
import { CoverageTotal } from './CoverageTotal';
import { ItemCard } from './ItemCard';
import { PlanSummaryCard } from './PlanSummaryCard';
import { QuestionCard } from './QuestionCard';
import { ReplanBanner } from './ReplanBanner';
import { StopCard } from './StopCard';
import { t } from '../copy/fa';

/* Fixtures: every data-derived field carries Latin text, the way real listings and shop names do. */
const LATIN_TOKENS = ['Galaxy A56', '4.2V', 'HAC-HDW1200CLQP', 'Aria Net', 'Alaedin Tower', 'Samsung', 'Dahua', '12V 2A', 'AHD / HDCVI'];

const line = (itemId: string): StopLine => ({
  itemId,
  qty: 2,
  state: 'suggested',
  productName: 'آداپتور Dahua 12V 2A',
  modelCode: 'HAC-HDW1200CLQP',
  listingTitle: 'آداپتور دوربین 4.2V مدل HAC-HDW1200CLQP Dahua',
  unitPrice: 190_000,
  lineTotal: 380_000,
  warranty: 'گارانتی Samsung',
  priceChangedAt: '2026-10-12',
  shopId: 's1',
  askSeller: ['آیا Galaxy A56 با آن کار می\u200Cکند؟'],
});

const stop = (itemId: string): Stop => {
  const l = line(itemId);
  return {
    id: 'st1',
    index: 1,
    mall: 'Alaedin Tower',
    floor: 'طبقهٔ ۶',
    unit: 'واحد ۶۲۲',
    shopId: 's1',
    shopName: 'Aria Net',
    address: 'خیابان شیخ\u200Cهادی، Alaedin Tower، واحد ۶۲۲',
    hoursText: 'ساعت کار 10:00 تا 19:00',
    open: 'open',
    lines: [l],
    shops: [
      { shopId: 's1', shopName: 'Aria Net', mall: 'Alaedin Tower', floor: 'طبقهٔ ۶', unit: 'واحد ۶۲۲', address: 'خیابان شیخ\u200Cهادی، Alaedin Tower', hoursText: 'ساعت کار 10:00 تا 19:00', open: 'open', lines: [l] },
    ],
  };
};

const plan: PlanResponse = {
  title: 'Galaxy A56',
  coverage: { covered: 1, total: 3, missing: [{ itemId: 'i2', name: 'Samsung Galaxy A56', why: 'x' }, { itemId: 'i3', name: 'قاب Galaxy A56', why: 'y' }] },
  totalToman: 380_000,
  usesSuggestions: true,
  complete: false,
  reason: 'کم\u200Cتوقف\u200Cترین گزینه در Alaedin Tower',
  stopCount: 1,
  stops: [stop('i1')],
  unpriced: [{ itemId: 'i4', name: 'Dahua 4.2V', sellers: [{ shopName: 'Aria Net', mall: 'Alaedin Tower', floor: 'طبقهٔ ۲' }] }],
  compat: [{ id: 'c1', level: 'assumed', text: 'دوربین\u200Cهای AHD / HDCVI به ضبط\u200Cکننده XVR وصل می\u200Cشوند', itemIds: ['i1'] }],
  alternatives: [{ id: 'fewest', label: 'کم\u200Cتوقف\u200Cتر Alaedin Tower', description: '۱ توقف در Aria Net', deltaToman: 0, deltaStops: 0 }],
  noAlternativesReason: 'فقط Aria Net دارد',
  activeVariant: null,
  visitActive: false,
  closedNotes: [{ text: 'Aria Net در این زمان بسته است' }],
  items: [
    { itemId: 'i2', state: 'not_found', pendingQuestions: 0 },
    { itemId: 'i3', state: 'needs_info', pendingQuestions: 1 },
  ],
};

const model: ModelOption = {
  productId: 'p1',
  name: 'Samsung Galaxy A56 5G 256GB',
  specs: ['Samsung', '12V 2A', 'HAC-HDW1200CLQP'],
  priceLow: 1_000_000,
  priceHigh: 2_000_000,
  sellerCount: 2,
  diffLabel: 'مدل Dahua 4.2V است',
  current: false,
  conflict: 'عنوان آگهی Galaxy A57 را می\u200Cگوید',
};
const seller: SellerOption = {
  shopId: 's1',
  shopName: 'Aria Net',
  mall: 'Alaedin Tower',
  floor: 'Floor 2',
  unit: 'Unit 5',
  listingTitle: 'آداپتور 4.2V Dahua',
  price: 100_000,
  warranty: 'گارانتی Samsung',
  hoursText: 'ساعت کار 10:00 تا 19:00',
  open: 'open',
  distanceNote: 'حدود ۹۰ متر تا Aria Net',
  current: false,
};

const req: Requirement = { id: 'i1', text: 'Galaxy A56 با 4.2V', qty: 1, categoryId: null, categoryLabel: '', chips: [] };
const deadRes: ItemResolution = {
  itemId: 'i1',
  state: 'alternative',
  pendingQuestions: 0,
  differs: 'Samsung Galaxy A56 دقیقاً پیدا نشد',
  noMatch: {
    reasonFa: 'Galaxy A56 زیر ۵۰ میلیون پیدا نشد',
    relax: [{ attr: 'budget', label: 'بدون سقف قیمت Samsung' }],
    closest: [model, { ...model, productId: 'p2', conflict: undefined }],
  },
};

let host: HTMLElement | null = null;
function mount(el: React.ReactElement): string {
  host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  flushSync(() => root.render(<MemoryRouter>{el}</MemoryRouter>));
  return document.body.innerHTML;
}
afterEach(() => {
  document.body.innerHTML = '';
  host = null;
});

/** What is left of the markup once every <bdi> and every tag is removed: no Latin letter may remain. */
function unisolatedLatin(html: string): string[] {
  const text = html
    .replace(/<bdi\b[^>]*>[\s\S]*?<\/bdi>/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ');
  return text.match(/[A-Za-z][A-Za-z0-9._-]*/g) ?? [];
}

const noop = () => undefined;

describe('every data-derived string is bidi-isolated', () => {
  const cases: [string, () => React.ReactElement][] = [
    ['ItemCard (dead end with noMatch)', () => <ItemCard req={req} res={deadRes} onChange={noop} onRemove={noop} onActivate={noop} onDetachChip={noop} />],
    [
      'ItemCard (suggested)',
      () => (
        <ItemCard
          req={req}
          res={{ itemId: 'i1', state: 'alternative', pendingQuestions: 0, product: { id: 'p1', name: 'Samsung Galaxy A56 5G' }, differs: 'مدل Dahua 4.2V' }}
          onChange={noop}
          onRemove={noop}
          onActivate={noop}
          onDetachChip={noop}
        />
      ),
    ],
    [
      'ItemCard (not found)',
      () => (
        <ItemCard
          req={req}
          res={{ itemId: 'i1', state: 'not_found', pendingQuestions: 0, reason: 'Galaxy A56 پیدا نشد', nearbyCategories: ['Phone Case'] }}
          onChange={noop}
          onRemove={noop}
          onActivate={noop}
          onDetachChip={noop}
        />
      ),
    ],
    [
      'QuestionCard',
      () => (
        <QuestionCard
          question={{ id: 'brand', itemId: 'i1', kind: 'attribute', prompt: 'برند Dahua یا Samsung؟', why: 'برای Galaxy A56', options: [{ id: 'a', label: 'Dahua', hint: '4.2V' }] }}
          answered={0}
          pending={1}
          onAnswer={noop}
          onEnough={noop}
        />
      ),
    ],
    ['PlanView (lines, stops, unpriced, compat, alternatives)', () => <PlanView plan={plan} busy={false} onShowSeller={noop} onChangeItem={noop} onSwitchVariant={noop} onOpenAssistant={noop} onOpenTime={noop} onGoList={noop} />],
    [
      'MarketView',
      () => <MarketView saved={blankPlan('Galaxy A56', [])} plan={plan} onToggle={noop} onShowSeller={noop} onUnavailable={noop} onPriceDiffers={noop} onPaid={noop} onRemoveReport={noop} onOptions={noop} />,
    ],
    ['StopCard', () => <StopCard stop={stop('i1')} number={1} visitActive={false} renderLines={() => null} />],
    ['ModelRow', () => <ModelRow m={model} onPick={noop} />],
    ['SellerRow', () => <SellerRow s={seller} reported={false} visitActive onPick={noop} />],
    ['CompatRow', () => <ul><CompatRow line={plan.compat[0]!} /></ul>],
    ['CoverageTotal (missing groups)', () => <CoverageTotal covered={1} total={3} amount={380_000} missing={[{ kind: 'not_found', names: ['Samsung Galaxy A56'] }, { kind: 'needs_info', names: ['قاب Galaxy A56'] }]} />],
    ['PlanSummaryCard', () => <PlanSummaryCard plan={blankPlan('گوشی Galaxy A56', [])} />],
    [
      'ReplanBanner',
      () => (
        <ReplanBanner
          info={{
            reportedShop: 'Aria Net',
            changes: [{ itemId: 'i1', name: 'Dahua 4.2V', kind: 'replaced', fromShop: 'Aria Net', toShop: 'Alaedin Tower' }],
            totalBefore: 1,
            totalAfter: 2,
          }}
          onUndo={noop}
          onDismiss={noop}
          onOthers={noop}
        />
      ),
    ],
    [
      'SellerSheet (open)',
      () => <SellerSheet open line={line('i1')} stop={stop('i1')} shop={stop('i1').shops![0]!} onClose={noop} onReport={noop} onRemoveReport={noop} />,
    ],
  ];

  for (const [name, make] of cases) {
    it(`${name}: no Latin text outside a <bdi>`, () => {
      const html = mount(make());
      expect(html.length).toBeGreaterThan(100);
      expect(unisolatedLatin(html)).toEqual([]);
    });
  }

  it('the fixtures really reach the screens: each Latin token sits inside a <bdi dir="ltr">', () => {
    const html = mount(
      <>
        <PlanView plan={plan} busy={false} onShowSeller={noop} onChangeItem={noop} onSwitchVariant={noop} onOpenAssistant={noop} onOpenTime={noop} onGoList={noop} />
        <ModelRow m={model} onPick={noop} />
        <SellerRow s={seller} reported={false} visitActive onPick={noop} />
      </>,
    );
    for (const tok of LATIN_TOKENS) {
      const inBdi = new RegExp(`<bdi dir="ltr"[^>]*>[^<]*${tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^<]*</bdi>`);
      expect(html, tok).toMatch(inBdi);
    }
  });
});

describe('BidiText', () => {
  const html = (text: string) => {
    const out = mount(<BidiText text={text} />);
    document.body.innerHTML = '';
    return out;
  };

  it('keeps «4.2V» as one LTR run (it used to render as «V4.2»)', () => {
    expect(html('آداپتور 4.2V دوربین')).toContain('>4.2V</bdi>');
    expect(html('4.2V')).toContain('>4.2V</bdi>');
  });
  it('starts a run at a digit when a Latin letter follows: «12V 2A», «5G»', () => {
    expect(html('آداپتور 12V 2A')).toContain('>12V 2A</bdi>');
    expect(html('گوشی 5G')).toContain('>5G</bdi>');
  });
  it('leaves plain ASCII digits without letters alone', () => {
    expect(html('۴ عدد 100 متر')).not.toContain('<bdi');
  });
  it('keeps «Galaxy A56» together and a sentence-final dot outside the run', () => {
    const out = html('گوشی Galaxy A56.');
    expect(out).toContain('>Galaxy A56</bdi>.');
  });
  it('sanitises bidi overrides before rendering', () => {
    expect(html('\u202Eگوشی\u202C Dahua')).not.toMatch(/[\u202A-\u202E]/);
  });
  it('Interp isolates data arguments inside a copy template', () => {
    const out = mount(<Interp tpl={t.plan.shop} args={['Aria Net']} />);
    expect(out).toContain('مغازهٔ «');
    expect(out).toContain('>Aria Net</bdi>');
  });
});
