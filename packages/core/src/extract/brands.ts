import { tokenizeForSearch } from '../normalize/index';

/**
 * Brand lexicon: the ~300 most frequent `brand_name` values of the dataset
 * (Persian display form as used by Torob) plus demo-domain brands that appear
 * mostly in titles (CCTV, HDD, phone accessories), with their Latin and
 * alternative Persian spellings.
 *
 * Entry: [key, display, aliases, titleMatch?]
 * - key: stable Latin slug (attrs.brand_key)
 * - display: Persian display name (products.brand)
 * - aliases: extra spellings (display is always an alias)
 * - titleMatch=false: the brand name is also an ordinary word (or too short /
 *   ambiguous), so it is only accepted from the brand_name field, never from
 *   free title text.
 */
type Entry = [key: string, display: string, aliases: string[], titleMatch?: boolean];

const RAW: Entry[] = [
  ['samsung', 'سامسونگ', ['samsung', 'سامسونک']],
  ['apple', 'اپل', ['apple', 'اپل', 'آپل']],
  ['xiaomi', 'شیائومی', ['xiaomi', 'شیامی', 'شیاومی', 'شیایومی', 'mi']],
  ['mvm', 'ام وی ام', ['mvm']],
  ['dahua', 'داهوا', ['dahua', 'دهوا', 'dh']],
  ['sony', 'سونی', ['sony']],
  ['hp', 'اچ\u200Cپی', ['hp', 'اچ پی', 'اچپی']],
  ['canon', 'کانن', ['canon']],
  ['hikvision', 'هایک ویژن', ['hikvision', 'هایکویژن', 'هایک ویژن', 'hik vision', 'هایک', 'hik']],
  ['hyundai', 'هیوندای', ['hyundai', 'هیوندا']],
  ['philips', 'فیلیپس', ['philips']],
  ['delta', 'دلتا', ['delta'], false],
  ['toyota', 'تویوتا', ['toyota']],
  ['casio', 'کاسیو', ['casio']],
  ['shoa', 'شعاع', ['shoa'], false],
  ['bosch', 'بوش', ['bosch']],
  ['ronix', 'رونیکس', ['ronix']],
  ['anker', 'انکر', ['anker', 'soundcore']],
  ['panasonic', 'پاناسونیک', ['panasonic']],
  ['chery', 'چری', ['chery'], false],
  ['nilper', 'نیلپر', ['nilper']],
  ['autonics', 'آتونیکس', ['autonics', 'اتونیکس']],
  ['wd', 'وسترن دیجیتال', ['western digital', 'westerndigital', 'وسترن', 'wd', 'وسترن دیجیتل']],
  ['peugeot', 'پژو', ['peugeot']],
  ['legrand', 'لگرند', ['legrand', 'لگراند']],
  ['pentax', 'پنتاکس', ['pentax']],
  ['lifan', 'لیفان', ['lifan']],
  ['pars-shoa-toos', 'پارس شعاع توس', ['پارس شعاع']],
  ['vira', 'ویرا', ['vira', 'ویرا الکتریک'], false],
  ['nokia', 'نوکیا', ['nokia']],
  ['haima', 'هایما', ['haima']],
  ['tavantak', 'توان تک', ['tavantak']],
  ['okam', 'اوکم', ['okam', 'o-kam', 'okam pro', 'اوکم پرو']],
  ['golnoor', 'گلنور', ['golnoor']],
  ['hamoon', 'هامون', [], false],
  ['datis', 'داتیس', ['datis'], false],
  ['saipa', 'سایپا', ['saipa']],
  ['mcdodo', 'مک دودو', ['mcdodo', 'مکدودو']],
  ['kia', 'کیا', ['kia'], false],
  ['lenovo', 'لنوو', ['lenovo']],
  ['pars', 'پارس', [], false],
  ['asus', 'ایسوس', ['asus']],
  ['citizen', 'سیتی زن', ['citizen', 'سیتیزن']],
  ['alborz-electric-noor', 'البرز الکتریک نور', ['لینکو', 'linco']],
  ['baseus', 'باسئوس', ['baseus', 'بیسوس', 'باسیوس']],
  ['camar', 'کامار', ['camar']],
  ['jbl', 'جی بی ال', ['jbl']],
  ['seiko', 'سیکو', ['seiko']],
  ['huawei', 'هوآوی', ['huawei', 'هواوی']],
  ['lg', 'ال جی', ['lg', 'الجی']],
  ['modi', 'مودی', ['modi'], false],
  ['tork', 'ترک', ['tork'], false],
  ['nova', 'نووا', [], false],
  ['asia', 'آسیا', [], false],
  ['nexans', 'نگزنس', ['nexans']],
  ['simpood', 'سیمپود', ['simpood', 'سیم پود']],
  ['live', 'لیو', [], false],
  ['earldom', 'ارلدام', ['earldom']],
  ['pars-khazar', 'پارس خزر', ['pars khazar']],
  ['ebara', 'ابارا', ['ebara', 'آبارا']],
  ['pumpiran', 'پمپیران', ['pumpiran']],
  ['nike', 'نایکی', ['nike', 'نایک']],
  ['pars-shahab', 'پارس شهاب', []],
  ['classic', 'کلاسیک', [], false],
  ['sandisk', 'سن دیسک', ['sandisk', 'سندیسک']],
  ['mitutoyo', 'میتوتویو', ['mitutoyo']],
  ['afratab', 'افراتاب', ['afratab']],
  ['motorola', 'موتورولا', ['motorola']],
  ['parto-electric', 'پرتو الکتریک', ['parto electric']],
  ['daewoo', 'دوو', ['daewoo'], false],
  ['delsey', 'دلسی', ['delsey']],
  ['yesido', 'یسیدو', ['yesido']],
  ['deland', 'دلند', ['deland', 'دلند الکتریک'], false],
  ['brighton', 'برایتون', ['brighton', 'briton']],
  ['simaran', 'سیماران', ['simaran']],
  ['simia', 'سیمیا', ['simia']],
  ['epson', 'اپسون', ['epson']],
  ['loris', 'لوریس', ['loris']],
  ['nikon', 'نیکون', ['nikon']],
  ['silex', 'سایلکس', ['silex']],
  ['seagate', 'سیگیت', ['seagate', 'سی گیت']],
  ['koyo', 'کویو', ['koyo']],
  ['somo', 'سومو', ['somo']],
  ['leo', 'لئو', [], false],
  ['renault', 'رنو', ['renault'], false],
  ['ikco', 'ایران خودرو', []],
  ['honor', 'آنر', ['honor'], false],
  ['hrui', 'اچ آر یو آی', ['hrui']],
  ['part-electric', 'پارت الکتریک', []],
  ['boya', 'بویا', ['boya']],
  ['roya', 'رویا', [], false],
  ['zfr', 'زد اف ار', ['zfr']],
  ['shouder', 'شودر', []],
  ['beurer', 'بیورر', ['beurer']],
  ['green-lion', 'گرین', ['green lion', 'گرین لاین', 'گرین لایون'], false],
  ['jac', 'جک', [], false],
  ['pioneer', 'پایونیر', ['pioneer']],
  ['saro', 'سارو', [], false],
  ['porodo', 'پرودو', ['porodo', 'پورودو']],
  ['we', 'دبلیو اند ای', ['w&e']],
  ['snowa', 'اسنوا', ['snowa']],
  ['stream', 'استریم', [], false],
  ['nillkin', 'نیلکین', ['nillkin', 'نیل کین']],
  ['mikrotik', 'میکروتیک', ['mikrotik']],
  ['xo', 'ایکس او', ['xo'], false],
  ['braun', 'براون', ['braun'], false],
  ['powerology', 'پاورولوجی', ['powerology', 'پاورولوژی']],
  ['tiandy', 'تیاندی', ['tiandy']],
  ['morfose', 'مورفوس', ['morfose']],
  ['rahatiran', 'راحتیران', []],
  ['yamaha', 'یاماها', ['yamaha']],
  ['cisco', 'سیسکو', ['cisco']],
  ['brilliance', 'برلیانس', ['brilliance']],
  ['proskit', 'پروسکیت', ['proskit', "pro'skit"]],
  ['melloni', 'ملونی', ['melloni']],
  ['vgr', 'وی جی آر', ['vgr']],
  ['ikea', 'ایکیا', ['ikea']],
  ['ldnio', 'الدینیو', ['ldnio', 'الدنیو']],
  ['intel', 'اینتل', ['intel']],
  ['parto-noor-toos', 'پرتو نور توس', []],
  ['tsco', 'تسکو', ['tsco']],
  ['max', 'مکس', [], false],
  ['logitech', 'لاجیتک', ['logitech']],
  ['schneider', 'اشنایدر', ['schneider']],
  ['teb-sanat', 'طب و صنعت', []],
  ['imou', 'آیمو', ['imou', 'ایمو']],
  ['tp-link', 'تی پی-لینک', ['tp-link', 'tplink', 'تی پی لینک']],
  ['royal', 'رویال', [], false],
  ['makita', 'ماکیتا', ['makita']],
  ['yaxun', 'یاکسون', ['yaxun']],
  ['maxeeder', 'مکسیدر', ['maxeeder']],
  ['gplus', 'جی پلاس', ['gplus', 'g plus'], false],
  ['julius', 'جولیوس', ['julius']],
  ['namanoor', 'نمانور', []],
  ['kelar', 'کلار', [], false],
  ['paradox', 'پارادوکس', ['paradox']],
  ['oppo', 'اوپو', ['oppo']],
  ['grandstream', 'گرنداستریم', ['grandstream', 'گرند استریم']],
  ['aeg', 'آ ا گ', ['aeg']],
  ['proone', 'پرووان', ['proone']],
  ['gmk', 'جی ام کا', ['gmk'], false],
  ['xvision', 'ایکس ویژن', ['xvision', 'x vision']],
  ['pars-arvand', 'پارس اروند الکتریک', ['پارس اروند']],
  ['mechanic', 'مکانیک', [], false],
  ['tissot', 'تیسوت', ['tissot']],
  ['ana', 'آنا', [], false],
  ['eyfel', 'ایفل', [], false],
  ['msi', 'ام اس آی', ['msi']],
  ['small-sun', 'اسمال سان', ['small sun']],
  ['goot', 'گات', ['goot'], false],
  ['migel', 'میگل', ['migel']],
  ['crown', 'کرون', ['crown'], false],
  ['naviforce', 'نیوی فورس', ['naviforce']],
  ['noorsho', 'نورشو', []],
  ['yealink', 'یالینک', ['yealink']],
  ['osram', 'اسرام', ['osram']],
  ['honda', 'هوندا', ['honda']],
  ['nissan', 'نیسان', ['nissan'], false],
  ['elig', 'الیگ', ['elig']],
  ['remington', 'رمینگتون', ['remington']],
  ['sunshine', 'سانشاین', ['sunshine']],
  ['metabo', 'متابو', ['metabo']],
  ['zhenyran', 'ژنیران', []],
  ['vivarex', 'ویوارکس', ['vivarex']],
  ['oral-b', 'اورال-بی', ['oral-b', 'oral b', 'اورال بی']],
  ['valeo', 'والئو', ['valeo']],
  ['tabarestan', 'طبرستان', [], false],
  ['lamp-noor', 'لامپ نور', [], false],
  ['covax', 'کواکس', ['covax']],
  ['coach', 'کوچ', ['coach'], false],
  ['nintendo', 'نینتندو', ['nintendo']],
  ['zenithmed', 'زنیتمد', ['zenithmed', 'زنیت مد']],
  ['nek', 'نک', ['nek'], false],
  ['sclaree', 'اسکلاره', []],
  ['elegance', 'الگانس', [], false],
  ['lineiran', 'لاینیران', []],
  ['navid-motor', 'نوید موتور', []],
  ['beston', 'بستون', ['beston']],
  ['callista', 'کالیستا', ['callista']],
  ['toshiba', 'توشیبا', ['toshiba']],
  ['ziehl-abegg', 'زیلابگ', ['ziehl-abegg', 'ziehl abegg']],
  ['hisense', 'هایسنس', ['hisense']],
  ['tak', 'تک', [], false],
  ['tanyar', 'تن یار', [], false],
  ['adata', 'ای دیتا', ['adata', 'ای\u200Cدیتا']],
  ['kaveh', 'کاوه', [], false],
  ['ken', 'کن', [], false],
  ['dell', 'دل', ['dell'], false],
  ['uniview', 'یو ان وی', ['uniview', 'unv', 'یونی ویو', 'یونیویو']],
  ['boss', 'باس', [], false],
  ['maxell', 'مکسل', ['maxell', 'maxcell']],
  ['anik', 'آنیک', ['anik']],
  ['ariak', 'آریاک', ['ariak']],
  ['rapoo', 'رپو', ['rapoo']],
  ['brother', 'برادر', ['brother'], false],
  ['camelion', 'کملیون', ['camelion']],
  ['orient', 'اورینت', ['orient'], false],
  ['rashen', 'راشن', [], false],
  ['shileh', 'شیله', [], false],
  ['sennheiser', 'سنهایزر', ['sennheiser']],
  ['tesla', 'تسلا', [], false],
  ['lutian', 'لوتیان', ['lutian']],
  ['varta', 'وارتا', ['varta']],
  ['romanson', 'رومانسون', ['romanson']],
  ['sayan', 'سایان', [], false],
  ['pinmed', 'پین مد', []],
  ['pyronix', 'پایرونیکس', ['pyronix', 'payronix']],
  ['iran-radiator', 'ایران رادیاتور', []],
  ['microsoft', 'مایکروسافت', ['microsoft']],
  ['dji', 'دی جی آی', ['dji']],
  ['sens', 'سنس', [], false],
  ['alja', 'آلجا', ['alja']],
  ['omron', 'امرن', ['omron', 'امرون']],
  ['ecolac', 'اکولاک', []],
  ['pasabahce', 'پاشاباغچه', ['pasabahce']],
  ['roncato', 'رونکاتو', ['roncato']],
  ['kwc', 'کی دبلیو سی', ['kwc']],
  ['damavand', 'دماوند', [], false],
  ['nazari', 'نظری', [], false],
  ['ecowatt', 'اکووات', []],
  ['westinghouse', 'وستینگ هاوس', ['westinghouse', 'وستینگهاوس']],
  ['easy-power', 'ایزی پاور', ['easy power']],
  ['zoom', 'زوم', [], false],
  ['karcher', 'کرشر', ['karcher', 'کارچر']],
  ['audio-technica', 'آدیو-تکنیکا', ['audio-technica', 'audio technica']],
  ['savoy', 'ساووی', ['savoy']],
  ['farnam', 'فرنام', [], false],
  ['babyliss', 'بابیلیس', ['babyliss', 'بابلیس']],
  ['ugreen', 'یوگرین', ['ugreen']],
  ['jiangdong', 'جیانگ دانگ', ['jiangdong']],
  ['ernie-ball', 'ارنی بال', ['ernie ball', 'ernieball']],
  ['promax', 'پروماکس', [], false],
  ['rolex', 'رولکس', ['rolex']],
  ['swiss-art', 'سوئیس آرت', []],
  ['xbox', 'ایکس باکس', ['xbox']],
  ['dp', 'دی پی', [], false],
  ['royal-canin', 'رویال کنین', ['royal canin']],
  ['farassoo', 'فراسو', [], false],
  ['jakemy', 'جاک می', ['jakemy', 'جکمی']],
  ['naser-plastic', 'ناصر پلاستیک', []],
  ['shure', 'شور', ['shure'], false],
  ['cummins', 'کامینز', ['cummins']],
  ['whiskas', 'ویسکاس', ['whiskas']],
  ['hqm', 'اچ کیو ام', ['hqm']],
  ['reflex', 'رفلکس', [], false],
  ['ls-audio', 'ال اس آدیو', []],
  ['loncin', 'لانسین', ['loncin']],
  ['vekto', 'وکتو', ['vekto']],
  ['rad-afshan-sahar', 'راد افشان سحر', ['رادافشان سحر']],
  ['fec', 'اف ای سی', ['fec']],
  ['nik-kala', 'نیک کالا', []],
  ['faran', 'فاران', ['faran'], false],
  ['edon', 'ادون', ['edon']],
  ['awei', 'اوی', ['awei'], false],
  ['mazda', 'مزدا', ['mazda']],
  ['golon', 'گولون', ['golon']],
  ['batis', 'باتیس', [], false],
  ['oscar', 'اسکار', [], false],
  ['d-net', 'دی-نت', ['d-net', 'dnet']],
  ['bwell', 'بی ول', ['b.well'], false],
  ['dorsa', 'درسا', [], false],
  ['chauffagekar', 'شوفاژکار', ['شوفاژ کار']],
  ['steel-alborz', 'استیل البرز', []],
  ['michano', 'میچانو', ['michano']],
  ['sharp', 'شارپ', ['sharp'], false],
  ['swatch', 'سواچ', ['swatch']],
  ['glamor', 'گلامور', ['glamor']],
  ['crest', 'کرست', ['crest'], false],
  ['isaco', 'ایساکو', ['isaco']],
  ['kasra', 'کسری', [], false],
  ['jts', 'جی تی اس', ['jts']],
  ['sta', 'اس تی ای', []],
  ['ergo', 'ارگو', [], false],
  ['savarez', 'ساوارز', ['savarez']],
  ['razer', 'ریزر', ['razer']],
  ['soheil', 'سهیل', [], false],
  ['jvc', 'جی وی سی', ['jvc']],
  ['htc', 'اچ تی سی', ['htc']],
  ['dunlop', 'دانلوپ', ['dunlop']],
  ['jasco', 'جاسکو', ['jasco']],
  ['hiwin', 'هایوین', ['hiwin']],
  ['aqua', 'آکوا', [], false],
  ['oneplus', 'وان پلاس', ['oneplus', 'one plus']],
  ['hi-q', 'های کیو', ['hi-q'], false],
  ['d-link', 'دی-لینک', ['d-link', 'dlink', 'دی لینک']],
  ['knipex', 'کنیپکس', ['knipex']],
  ['quick', 'کوئیک', [], false],
  ['volvo', 'ولوو', ['volvo']],
  ['hanofer', 'هانوفر', ['hanofer']],
  ['alborz-afshan', 'البرز افشان', []],
  ['akg', 'ای کی جی', ['akg']],
  ['caterpillar', 'کاترپیلار', ['caterpillar']],
  ['olight', 'اولایت', ['olight']],
  ['unique', 'یونیک', [], false],
  ['joway', 'جووی', ['joway']],
  ['niroo-cable-zagros', 'نیرو کابل زاگرس', ['نیروکابل زاگرس']],
  ['avent', 'اونت', ['avent']],
  // demo-domain brands seen mostly in titles
  ['cpplus', 'سی پی پلاس', ['cpplus', 'cp plus', 'cp-plus']],
  ['habel', 'حابل', ['habel']],
  ['clarent', 'کلارنت', ['clarent', 'celarent']],
  ['hares', 'حارس', ['hares']],
  ['ezviz', 'ازویز', ['ezviz', 'ای زد ویز']],
  ['tvt', 'تی وی تی', ['tvt']],
  ['itr', 'آی تی آر', ['itr']],
  ['hivideo', 'های ویدیو', ['hivideo', 'hi video']],
  ['raimon', 'رایمون', []],
  ['visitron', 'ویزیترون', ['visitron', 'vizitron']],
  ['blurams', 'بلورمز', ['blurams']],
  ['refaco', 'رفاکو', ['refaco']],
  ['uniarch', 'یونی\u200Cآرک', ['uniarch', 'یونی آرک']],
  ['hgst', 'اچ جی اس تی', ['hgst']],
  ['spigen', 'اسپیگن', ['spigen']],
  ['google', 'گوگل', ['google']],
  ['realme', 'ریلمی', ['realme']],
  ['vivo', 'ویوو', ['vivo'], false],
  ['nothing', 'ناتینگ', [], false],
  ['infinix', 'اینفینیکس', ['infinix']],
  ['tecno', 'تکنو', ['tecno'], false],
  ['mietubl', 'میتوبل', ['mietubl']],
  ['buff', 'بوف', ['buff'], false],
  ['lito', 'لیتو', ['lito']],
  ['doogee', 'دوجی', ['doogee']],
  ['samurai', 'سامورایی', ['samurai']],
  ['belkin', 'بلکین', ['belkin']],
  ['momax', 'مومکس', ['momax']],
  ['joyroom', 'جوی روم', ['joyroom']],
  ['romoss', 'روموس', ['romoss']],
  ['energizer', 'انرجایزر', ['energizer']],
  ['oraimo', 'اُرایمو', ['oraimo', 'ارایمو']],
  ['usams', 'یوسمز', ['usams']],
  ['verity', 'وریتی', ['verity']],
  ['kingston', 'کینگستون', ['kingston']],
  ['transcend', 'ترنسند', ['transcend']],
  ['silicon-power', 'سیلیکون پاور', ['silicon power']],
  ['samsung-galaxy', 'سامسونگ', ['galaxy', 'گلکسی'], true],
];

export interface BrandEntry {
  key: string;
  display: string;
  titleMatch: boolean;
  /** each alias as a token sequence (tokenizeForSearch) */
  aliasTokens: string[][];
}

/** Brand keys that are aliases of another key (product families -> maker). */
const KEY_REDIRECT: Record<string, string> = { 'samsung-galaxy': 'samsung' };

export const BRANDS: BrandEntry[] = RAW.map(([key, display, aliases, titleMatch]) => {
  const all = [display, ...aliases];
  const seen = new Set<string>();
  const aliasTokens: string[][] = [];
  for (const a of all) {
    const t = tokenizeForSearch(a);
    // glued variant too («هایک ویژن» -> «هایکویژن»)
    for (const v of [t, t.length > 1 ? [t.join('')] : null]) {
      if (!v || v.length === 0) continue;
      const s = v.join(' ');
      if (seen.has(s)) continue;
      seen.add(s);
      aliasTokens.push(v);
    }
  }
  return { key: KEY_REDIRECT[key] ?? key, display, titleMatch: titleMatch !== false, aliasTokens };
});

const BY_KEY = new Map<string, BrandEntry>();
for (const b of BRANDS) if (!BY_KEY.has(b.key)) BY_KEY.set(b.key, b);

/** Index: first token -> [entry, alias tokens] (longest alias first). */
const FIRST_TOKEN = new Map<string, Array<[BrandEntry, string[]]>>();
for (const b of BRANDS) {
  for (const al of b.aliasTokens) {
    const f = al[0] as string;
    const list = FIRST_TOKEN.get(f) ?? [];
    list.push([b, al]);
    FIRST_TOKEN.set(f, list);
  }
}
for (const list of FIRST_TOKEN.values()) list.sort((a, b) => b[1].length - a[1].length);

/** Short Latin aliases that are only accepted as stand-alone tokens with care. */
const WEAK_ALIASES = new Set(['mi', 'dh', 'hik', 'wd', 'هایک', 'وسترن', 'galaxy', 'گلکسی', 'xo']);

export interface BrandHit {
  key: string;
  display: string;
  tokenIndex: number;
  weak: boolean;
}

/** All lexicon brands mentioned in a token list (title-matchable entries only). */
export function findBrandsInTokens(tokens: string[], opts: { includeNonTitle?: boolean } = {}): BrandHit[] {
  const hits: BrandHit[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const cands = FIRST_TOKEN.get(tokens[i] as string);
    if (!cands) continue;
    for (const [entry, al] of cands) {
      if (!entry.titleMatch && !opts.includeNonTitle) continue;
      let ok = true;
      for (let j = 1; j < al.length; j++) if (tokens[i + j] !== al[j]) { ok = false; break; }
      if (!ok) continue;
      hits.push({ key: entry.key, display: BY_KEY.get(entry.key)?.display ?? entry.display, tokenIndex: i, weak: al.length === 1 && WEAK_ALIASES.has(al[0] as string) });
      i += al.length - 1;
      break;
    }
  }
  return hits;
}

/** Map a brand_name field value to a lexicon entry (exact alias match on the whole value). */
export function lookupBrandField(value: string | null | undefined): BrandEntry | null {
  if (!value) return null;
  const toks = tokenizeForSearch(value);
  if (toks.length === 0) return null;
  const cands = FIRST_TOKEN.get(toks[0] as string) ?? [];
  for (const [entry, al] of cands) {
    if (al.length === toks.length && al.every((t, i) => t === toks[i])) return BY_KEY.get(entry.key) ?? entry;
  }
  const glued = FIRST_TOKEN.get(toks.join(''));
  if (glued) for (const [entry, al] of glued) if (al.length === 1) return BY_KEY.get(entry.key) ?? entry;
  return null;
}

export function brandByKey(key: string): BrandEntry | undefined {
  return BY_KEY.get(key);
}
