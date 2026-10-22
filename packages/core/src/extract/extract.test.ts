import { describe, expect, it } from 'vitest';
import { deviceModelBase, extractDeviceModels, extractModelCodes, extractProduct, modelCodeKeys, resolveBrand } from './index';

const x = (title: string, categoryName: string, brandField: string | null = null, modelField: string | null = null) =>
  extractProduct({ title, categoryName, brandField, modelField });

// All titles below are real titles from the dataset.
describe('CCTV camera', () => {
  const C = 'دوربین مدار بسته';
  it('reads megapixels and signal from the title', () => {
    expect(x('دوربین مداربسته بولت AHD مدل PR550', C).attrs).toMatchObject({ signal: 'ahd', form: 'bullet' });
    expect(x('دوربین مداربسته | پنج مگاپیکسل SONY 335 L12 | IP | بدون POE', C).attrs).toMatchObject({ mp: 5, signal: 'ip' });
    expect(x('دوربین مداربسته آنالوگ (HDCVI) داهوا مدل DH-HAC-HDW1500TLMP-0280B-S2', C, 'داهوا').attrs).toMatchObject({ mp: 5, signal: 'hdcvi' });
  });
  it('decodes Dahua / Hikvision model codes and marks the source', () => {
    const r = x('دوربین مداربسته هایک ویژن DS-2CD2643G2-LIZS2U', C, 'هایک ویژن');
    expect(r.attrs).toMatchObject({ mp: 4, signal: 'ip', _src: { mp: 'model_code', signal: 'model_code' } });
    expect(x('DH-HAC-HFW1200TLP', C).attrs).toMatchObject({ mp: 2, signal: 'hdcvi' });
    expect(x('دوربین مداربسته هایک ویژن DS-2CE10HFT-F', C, 'هایک ویژن').attrs).toMatchObject({ mp: 5, signal: 'analog' });
  });
  it('ptz / wifi / sim flags', () => {
    expect(x('مینی اسپید دام دولنز 5مگاپیکسل وای فای V380', C).attrs).toMatchObject({ mp: 5, ptz: true, wifi: true });
    expect(x('دوربین سیمکارتی ۳ لنز چرخشی V380 Pro بدون نقطه کور', C).attrs).toMatchObject({ ptz: true, sim: true });
  });
  it('leaves unknowns absent', () => {
    const r = x('دوربین مداربسته آنجل مدل CG-BIP3061MC', C);
    expect(r.attrs.mp).toBeUndefined();
    expect(r.attrs.signal).toBeUndefined();
  });
  it('conflicting title and code => unknown', () => {
    // title says AHD, code says IP camera
    expect(x('دوربین AHD مدل IPC-HFW1230S', C).attrs.signal).toBeUndefined();
  });
});

describe('recorder', () => {
  const R = 'ضبط کننده ویدیویی دوربین‌های نظارتی و امنیتی';
  it('kind and channels from title and code', () => {
    expect(x('دستگاه XVR با 4 کانال داهوا مدل XVR1B04-I/T با قابلیت ارتباط دو طرفه', R, 'داهوا').attrs).toMatchObject({ kind: 'xvr', channels: 4 });
    expect(x('رکوردر داهوا مدل NVR4216-EI', R, 'داهوا').attrs).toMatchObject({ kind: 'nvr', channels: 16 });
    expect(x('دستگاه DVR هایک ویژن مدل DS7216HGHI-M1 ظرفیت ۱۶ کانال', R).attrs).toMatchObject({ kind: 'dvr', channels: 16 });
    expect(x('NVR ده کاناله تحت شبکه 4K مدل 88X10-4K', R).attrs).toMatchObject({ kind: 'nvr', channels: 10 });
  });
  it('model code beats the seller wording for kind', () => {
    expect(x('ان وی آر داهوا مدل XVR5104HS-I3(V3.0)', R, 'داهوا').attrs.kind).toBe('xvr');
  });
  it('title/code channel conflict and channel lists => unknown', () => {
    expect(x('دستگاه NVR ضبط تصاویر ۵ کانال برند تیاندی مدل TC-R3104', R).attrs.channels).toBeUndefined();
    expect(x('باندل دو دستگاه 4و 8 کانال AHD', R).attrs.channels).toBeUndefined();
  });
});

describe('HDD', () => {
  const H = 'هارد دیسک اینترنال';
  it('capacity, surveillance line, ssd', () => {
    expect(x('هارد دیسک اینترنال وسترن دیجیتال مدل WD10PURZ ظرفیت ۱ ترابایت', H).attrs).toMatchObject({ tb: 1, line: 'purple', surveillance: true, ssd: false });
    expect(x('هارد 500 گیگابایت وسترن دیجیتال آبی شرکتی', H).attrs).toMatchObject({ tb: 0.5, line: 'blue', surveillance: false });
    expect(x('هارددیسک اینترنال سیگیت مدل SkyHawk ST12000VX0008 ظرفیت 12 ترابایت گارانتی 12 ماهه شرکتی', H).attrs).toMatchObject({ tb: 12, surveillance: true });
  });
  it('model-code capacity that contradicts the title => unknown', () => {
    expect(x('هارد دیسک اینترنال وسترن دیجیتال WD Purple WD10PURZ با ظرفیت 4 ترابایت', H).attrs.tb).toBeUndefined();
  });
  it('used / refurbished', () => {
    expect(x('حافظه اچ دی دی اینترنال وسترن دیجیتال مدل قرمز ظرفیت 12 ترابایت استوک', H).attrs.condition).toBe('used');
  });
});

describe('adapter', () => {
  const A = 'آداپتور برق';
  it('volts and amps incl. milliamps and Persian decimal slash', () => {
    expect(x('آداپتور 48 ولت 500 میلی آمپر POE دیواری', A).attrs).toMatchObject({ volts: 48, amps: 0.5, poe: true });
    expect(x('آداپتور ۱۹/۵ ولت ۲/۳۱ آمپر برند DELL اصلی مدل DA45NM104-00 سر فیش دلی', A).attrs).toMatchObject({ volts: 19.5, amps: 2.31 });
    expect(x('آداپتور 12 ولت 2 آمپر ریور مدل 12V-2A', A).attrs).toMatchObject({ volts: 12, amps: 2 });
  });
  it('mains input is not the output; variable adapters have no single voltage', () => {
    expect(x('ترانس 220 به 110 ولت 40 وات', A).attrs.volts).toBeUndefined();
    const v = x('آداپتور متغیر 3 تا 12 ولت 2 امپر', A).attrs;
    expect(v.volts).toBeUndefined();
    expect(v).toMatchObject({ amps: 2, variable: true });
  });
  it('device brand in an adapter title is not the brand', () => {
    expect(x('آداپتور دیواری 12 ولت 3 آمپر مانیتور ال‌جی', A).brand).toBeNull();
  });
});

describe('building wire', () => {
  const W = 'سیم و کابل برق ساختمان';
  it('cores x section in both orders', () => {
    expect(x('کابل افشان 4 در 6 (4x6) هادی کابل البرز', W).attrs).toMatchObject({ cores: 4, section_mm2: 6, strand: 'flexible' });
    expect(x('کابل افشان 2.5x3 مغان', W).attrs).toMatchObject({ cores: 3, section_mm2: 2.5 });
    expect(x('کابل افشان 2×1/5 یک حلقه', W).attrs).toMatchObject({ cores: 2, section_mm2: 1.5 });
    expect(x('سیم 2/5 البرز ابهر مدل افشان', W).attrs).toMatchObject({ cores: 1, section_mm2: 2.5 });
  });
  it('sale unit', () => {
    expect(x('کابل افشان افشار نژاد خراسان سطح مقطع 5 در 16(فروش به صورت حلقه ۱۰۰ متری)', W).attrs).toMatchObject({ sale_unit: 'roll100', roll_m: 100 });
    expect(x('کابل افشان زیتون سایز 6×5 - واحد فروش متر', W).attrs).toMatchObject({ cores: 5, section_mm2: 6, sale_unit: 'meter' });
    expect(x('سیم نایلونی ۲ در ۲/۵ cca برق کلاف ۹۲متری', W).attrs).toMatchObject({ sale_unit: 'other', roll_m: 92 });
  });
  it('reduced-neutral cables and odd units => unknown section', () => {
    expect(x('کابل افشان 16+25×3 مشهد', W).attrs.section_mm2).toBeUndefined();
    expect(x('کابل افشان 3 در 70 به علاوه 35 خراسان افشار نژاد', W).attrs.section_mm2).toBeUndefined();
    expect(x('سیم 25صدم روکش سیلیکون قلع اندود افشان 10 متری', W).attrs.section_mm2).toBeUndefined();
  });
});

describe('phones and accessories', () => {
  it('phone memory and model', () => {
    const r = x('گوشی سامسونگ (ویتنام) S25 Ultra 5G | حافظه 1 ترابایت رم 12 گیگابایت', 'گوشی موبایل', 'سامسونگ');
    expect(r.attrs).toMatchObject({ storage_gb: 1024, ram_gb: 12, model_key: 'galaxy s25 ultra 5g', network: '5g' });
    expect(x('گوشی هانوفر H3 | حافظه 64 رم 3 گیگابایت', 'گوشی موبایل').attrs).toMatchObject({ storage_gb: 64, ram_gb: 3 });
    expect(x('گوشی نوکیا 2017 130 | حافظه 8 مگابایت', 'گوشی موبایل', 'نوکیا').attrs.storage_gb).toBeUndefined();
  });
  it('fits_models: one or several models, exact variants', () => {
    expect(x('قاب Spigen مدل Samsung S22ultra - شفاف مشکی', 'کیف و کاور گوشی', 'سامسونگ').attrs.fits_models).toEqual(['galaxy s22 ultra']);
    expect(x('محافظ صفحه نمایش شیشه ای اورجینال XMART - Magic Glass Box مدل Apple iPhone 13 / iPhone 13 Pro / iPhone 14 / 16e (پک دار)', 'محافظ صفحه نمایش گوشی', 'اپل').attrs.fits_models).toEqual([
      'iphone 13',
      'iphone 13 pro',
      'iphone 14',
      'iphone 16e',
    ]);
    expect(x('قاب شیائومی آ۲ پلاس', 'کیف و کاور گوشی', 'شیائومی').attrs.fits_models).toBeUndefined();
    expect(x('قاب سامسونگ آ33 سیلیکونی', 'کیف و کاور گوشی', 'سامسونگ').attrs.fits_models).toEqual(['galaxy a33']);
    expect(x('گلس نیلکین آیفون iPhone 17 Air مدل H+ Pro tempered glass', 'محافظ صفحه نمایش گوشی', 'اپل').attrs.fits_models).toEqual(['iphone 17 air']);
    expect(x('گلس اوپو رنو 5 پرو 5جی | Glass Oppo Reno 5 Pro 5G', 'محافظ صفحه نمایش گوشی', 'اوپو').attrs.fits_models).toContain('oppo reno 5 pro 5g');
  });
  it('generic multi-brand accessories have no fits_models', () => {
    expect(x('قاب گوشی دخترانه پاپیون صورتی مخصوص گوشی‌های سامسونگ، آیفون و شیائومی', 'کیف و کاور گوشی', 'سامسونگ').attrs.fits_models).toBeUndefined();
  });
  it('deviceModelBase strips the network variant', () => {
    expect(deviceModelBase('galaxy a52 5g')).toBe('galaxy a52');
    expect(extractDeviceModels('Galaxy A7 2016 (A710)', 'samsung')).toEqual(['galaxy a7 2016']);
    // a year is never the model number
    expect(extractDeviceModels('باندل سه عددی گوشی نوکیا 2019 105 | حافظه 4 مگابایت')).toEqual(['nokia 105 2019']);
    expect(extractDeviceModels('گوشی با گارانتی تاشو نوکیا2660 ( ویتنام ) Flip | Nokia 2660')).toEqual(['nokia 2660']);
    expect(extractDeviceModels('گوشی نوکیا 2020')).toEqual([]);
  });
});

describe('brand and model codes', () => {
  it('brand field maps to lexicon key; title lexicon only when unambiguous', () => {
    expect(resolveBrand('x', 'هایک ویژن', null, null)).toMatchObject({ brand: 'هایک ویژن', brandKey: 'hikvision' });
    expect(resolveBrand('دوربین مدار بسته حابل Habel HNC-B6535-L', null, 'دوربین مدار بسته', 'cctv_camera')).toMatchObject({ brandKey: 'habel', fromTitle: true });
    expect(resolveBrand('هارد WD مدل ELEMENT ظرفیت 1TB', null, 'هارد دیسک اینترنال', 'hdd')).toMatchObject({ brandKey: 'wd' });
    // two different brands named => unknown
    expect(resolveBrand('دوربین سیمکارتی سه لنز با سنسور SONY همراه رم 64 گیگ سندیسک', null, 'دوربین مدار بسته', 'cctv_camera').brandKey).toBeNull();
  });
  it('extracts letter-digit codes and drops units', () => {
    const codes = modelCodeKeys(extractModelCodes('دستگاه ضبط کننده ویدیویی داهوا مدل DH-XVR5108-4KL-I3 12V 2A 5MP H.265 2.8-12mm'));
    expect(codes).toContain('DHXVR51084KLI3');
    expect(codes).toContain('XVR51084KLI3');
    expect(codes).toContain('XVR5108');
    expect(codes.some((c) => /^(12V|2A|5MP|H265)$/.test(c))).toBe(false);
    expect(modelCodeKeys(extractModelCodes('کنتاکتور اشنایدر LC1D95AM7'))).toEqual(['LC1D95AM7']);
  });
});

// G3b: a named analog format in the title is not dropped against a generic analog model code (and the reverse refinement).
describe('CCTV camera signal: named analog format vs analog model code', () => {
  const C = 'دوربین مدار بسته';
  const sig = (title: string, brand: string | null = null) => x(title, C, brand).attrs.signal;
  it('TVI / Turbo HD in the title wins over a Hikvision DS-2CE (analog family) code', () => {
    expect(sig('دوربین مداربسته هایکویژن TVI 2مگاپیکسل مدل DS-2CE56D0T-IT1F', 'هایک ویژن')).toBe('tvi');
    expect(sig('دوربین توربو HD هایک ویژن مدل DS-2CE76D0T-LMFS', 'هایک ویژن')).toBe('tvi');
    expect(sig('دوربین بولت TURBO HD هایک ویژن مدل DS-2CE16D0T-ITPFS', 'هایک ویژن')).toBe('tvi');
    expect(x('دوربین مداربسته هایکویژن TVI مدل DS-2CE56D0T-IT1F', C, 'هایک ویژن').attrs._src).not.toHaveProperty('signal');
  });
  it('Persian spellings of TVI / CVI / AHD', () => {
    expect(sig('دوربین مداربسته تی وی آی مدل DS-2CE56D0T-IT1F')).toBe('tvi');
    expect(sig('دوربین مداربسته تی‌وی‌آی 2 مگاپیکسل')).toBe('tvi');
    expect(sig('دوربین مداربسته اچ دی تی وی آی 5 مگاپیکسل')).toBe('tvi');
    expect(sig('دوربین مداربسته HD-TVI 5MP')).toBe('tvi');
    expect(sig('دوربین مداربسته سی وی آی 2 مگاپیکسل')).toBe('hdcvi');
    expect(sig('دوربین مداربسته HD-CVI 2MP')).toBe('hdcvi');
    expect(sig('دوربین مداربسته HDCVI 2MP')).toBe('hdcvi');
    expect(sig('دوربین مداربسته ای اچ دی 2 مگاپیکسل')).toBe('ahd');
    expect(sig('دوربین مداربسته ایی اچ دی 2 مگاپیکسل')).toBe('ahd');
    expect(sig('دوربین مداربسته AHD 2MP')).toBe('ahd');
  });
  it('a format glued to Persian words or digits is read; a longer Latin word is not', () => {
    expect(sig('دوربین پین‌هول AHD2MP مدل CAM7')).toBe('ahd');
    expect(sig('دوربین مداربسته بالتAHD برند ITR مدل +ITR-R296HM')).toBe('ahd');
    expect(sig('دوربین مداربسته 5مگاپیکسلAHD 5MP U2101')).toBe('ahd');
    expect(sig('دوربین مداربسته AHDمدل BM4_52')).toBe('ahd');
    expect(sig('دوربین مدار بسته مدل MAHDI-22')).toBeUndefined();
  });
  it('AHD against a Uniview UAC- code is AHD; two different named formats stay unknown', () => {
    expect(sig('دوربین AHD برند یونی‌ویو(Uniview) مدل UAC-T124-AF28LM | دام 4 مگاپیکسل')).toBe('ahd');
    expect(sig('دوربین AHD داهوا مدل DH-HAC-HFW1509TLMP', 'داهوا')).toBeUndefined();
    expect(sig('دوربین TVI داهوا مدل DH-HAC-HFW1509TLMP', 'داهوا')).toBeUndefined();
  });
  it('a generic «آنالوگ» title is refined by the Dahua HAC- = HDCVI convention (source: model code)', () => {
    const r = x('دوربین مداربسته آنالوگ داهوا مدل DH-HAC-B2A21', C, 'داهوا');
    expect(r.attrs).toMatchObject({ signal: 'hdcvi', _src: { signal: 'model_code' } });
    // several named formats in the title: the family, whatever the code says
    expect(sig('دوربین AHD/TVI/CVI داهوا مدل DH-HAC-B2A21', 'داهوا')).toBe('analog');
  });
  it('IP against an analog format stays unknown', () => {
    expect(sig('دوربین IP توربو HD مدل DS-2CE56D0T')).toBeUndefined();
  });
  it('plain analog stays analog', () => {
    expect(sig('دوربین مداربسته آنالوگ 2 مگاپیکسل')).toBe('analog');
    expect(sig('دوربین مداربسته آنالوگ مدل DS-2CE56D0T-IT1F', 'هایک ویژن')).toBe('analog');
  });
});

// G3b: look-alike phones («گوشی طرح ورتو / S26»), headphones, explicit not-original claims; «طرح دار» is a pattern.
describe('replica: look-alike markers', () => {
  const rep = (title: string, category: string) => x(title, category).attrs.replica;
  const P = 'گوشی موبایل';
  const H = 'هدفون، هدست و هندزفری';
  it('phones: «طرح <brand>» and «طرح <Latin model>»', () => {
    expect(rep('گوشی طرح ورتو V77', P)).toBe(true);
    expect(rep('گوشی طرح ورتو (استوک) V10 | حافظه 32 مگابایت', P)).toBe(true);
    expect(rep('گوشی طرح ورتو Signature Dragon | حافظه 4 گیگابایت', P)).toBe(true);
    expect(rep('گوشی طرح S26 Ultra mini 45 INCH| حافظه 16 رم 2 گیگابایت', P)).toBe(true);
    expect(rep('گوشی طرح اپل iphone 16 pro max | حافظه 256 رم 8 گیگابایت', P)).toBe(true);
    expect(rep('گوشی طرح نوکیا 110 2019', P)).toBe(true);
    expect(rep('گوشی طرح سامسونگ S25 Ultra', P)).toBe(true);
  });
  it('headphones: «طرح ایرپاد»', () => {
    expect(rep('هندزفری بلوتوثی طرح ایرپاد پرو برند کینگ پلاس مدل HK-60', H)).toBe(true);
    expect(rep('ایرپاد برند کینگ پلاس طرح ایرپاد 2 مدل KING+ HK-70', H)).toBe(true);
  });
  it('explicit not-original claims', () => {
    expect(rep('گوشی موبایل برند X مدل Y اورجینال نیست', P)).toBe(true);
    expect(rep('باتری موبایل مشابه اصلی شیائومی Redmi Note 3 BM46 Battery', 'باتری گوشی موبایل')).toBe(true);
    expect(rep('هندزفری غیر اورجینال سامسونگ', H)).toBe(true);
    expect(rep('گوشی تقلبی مدل Z', P)).toBe(true);
  });
  it('patterns, styles and originals are not replicas', () => {
    expect(rep('کاور طرح دار مناسب گوشی تی سی ال 50SE', 'کیف و کاور گوشی')).toBeUndefined();
    expect(rep('قاب گوشی طرح گل رز سفید مخصوص انواع مدل‌های گوشی', 'کیف و کاور گوشی')).toBeUndefined();
    expect(rep('قاب گوشی طرح یانگ کیت اپل iPhone 15 Pro Max - یاسی', 'کیف و کاور گوشی')).toBeUndefined();
    expect(rep('هندزفری طرح فانتزی خرگوش مدل Rabbit-MC-137 به همراه کیف هندزفری', H)).toBeUndefined();
    expect(rep('هدفون بلوتوثی کی تی مدل KT58B طرح گربه ای', H)).toBeUndefined();
    expect(rep('ایرپاد پرو 2 طرح پرچم آمریکا', H)).toBeUndefined();
    expect(rep('شارژر Divoom Dipow-65W - طرح Medal Yellow', 'شارژر گوشی')).toBeUndefined();
    expect(rep('گوشی سامسونگ (چین) A06 | حافظه 128 رم 6 گیگابایت', P)).toBeUndefined();
    expect(rep('باتری اصلی سامسونگ Galaxy E5', 'باتری گوشی موبایل')).toBeUndefined();
    expect(rep('گوشی موبایل سامسونگ Galaxy A55 (اورجینال)', P)).toBeUndefined();
    expect(rep('گوشی مدل X طرح 2023 دو سیم کارت', P)).toBeUndefined();
  });
  it('no extraction domain, no flag (photocopiers)', () => {
    expect(rep('دستگاه کپی طرح اپل', 'پرینتر')).toBeUndefined();
  });
});
