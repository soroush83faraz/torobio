/**
 * Chips-only assistant used when the server-side assistant is not available (501, degraded, timeout).
 * It only maps the five chips (and two obvious words) onto requirement-state actions using the real plan's
 * own alternatives; it never invents anything. The caller applies the action and shows the diff + undo.
 */
import type { ApiAdapter } from './client';
import type { AssistRequest, AssistResponse } from './types';
import { shopsOf } from '../lib/stops';
import { isVisitActive } from '../lib/visitActive';

const UNAVAILABLE = 'یکی از گزینه‌های بالا را بزن یا درخواستت را ساده‌تر بنویس.';

/** Every answer here is `degraded`: the server-side assistant could not be reached, only the chips work. */
const no = (message: string): AssistResponse => ({ message, action: { type: 'none' }, supported: false, degraded: true });
const yes = (message: string, action: AssistResponse['action']): AssistResponse => ({ message, action, supported: true, degraded: true });

export async function assistFallback(req: AssistRequest, api: Pick<ApiAdapter, 'plan'>): Promise<AssistResponse> {
  const text = (req.text ?? '').replace(/[‌‏]/g, ' ');
  const chip = req.chip ?? (/ارزان/.test(text) ? 'cheaper' : /نزدیک|توقف/.test(text) ? 'fewer_stops' : undefined);
  if (!chip) return no(UNAVAILABLE);

  if (chip === 'cheaper') {
    return yes('ارزان‌ترین ترکیب با همین پوشش انتخاب شد.', { type: 'set_variant', value: null });
  }
  if (chip === 'only_open') {
    return isVisitActive(req.state.visit)
      ? yes('مغازه‌های بسته در زمانی که انتخاب کردی از قبل کنار گذاشته شده‌اند.', { type: 'none' })
      : no('برای دیدن مغازه‌های باز، اول «کی می‌روی؟» را مشخص کن.');
  }

  const plan = await api.plan({ state: req.state });
  if (chip === 'without_shop') {
    const shops = plan.stops.flatMap((s) => shopsOf(s));
    // only the shop the sheet was opened from, or the plan's only shop: never a guess
    const shop = shops.find((s) => s.shopId === req.context?.shopId) ?? (shops.length === 1 ? shops[0] : undefined);
    if (!shop) return no(shops.length === 0 ? 'هنوز توقفی در برنامه نیست.' : 'برای کنار گذاشتن یک مغازه، از کارت همان مغازه «بدون این مغازه» را بزن.');
    return yes(`مغازهٔ «${shop.shopName}» از برنامه کنار گذاشته شد.`, { type: 'exclude_shop', shopId: shop.shopId });
  }
  // closer / fewer_stops: the non-dominated option with fewer stops, if there is one
  const fewer = plan.alternatives.find((a) => a.deltaStops < 0);
  if (!fewer) {
    return no(`با این فهرست امکانش نیست؛ ${plan.noAlternativesReason ?? 'ترکیب دیگری وجود ندارد.'} نزدیک‌ترین کار همین برنامهٔ فعلی است.`);
  }
  return yes(`برنامه با توقف کمتر ساخته شد: ${fewer.description}.`, { type: 'set_variant', value: fewer.id });
}
