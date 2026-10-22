/**
 * Stop = building; a stop holds one or more shops, each with its own floor/unit/hours and lines.
 * Older responses (and the mock) have no `shops[]`: the stop's top-level shop fields then describe the one shop.
 */
import type { ConditionFlag, Stop, StopLine, StopShop } from '../api/types';

export function shopsOf(stop: Stop): StopShop[] {
  if (stop.shops && stop.shops.length > 0) return stop.shops;
  return [
    {
      shopId: stop.shopId,
      shopName: stop.shopName,
      mall: stop.mall,
      floor: stop.floor,
      unit: stop.unit,
      address: stop.address,
      hoursText: stop.hoursText,
      open: stop.open,
      lines: stop.lines,
    },
  ];
}

/** Every line of the plan, across stops and shops. */
export function allLines(stops: readonly Stop[]): StopLine[] {
  return stops.flatMap((s) => shopsOf(s).flatMap((sh) => sh.lines));
}

/** The shop of a stop that sells `line` (by shopId; the first shop when the id is unknown). */
export function shopOfLine(stop: Stop, line: StopLine): StopShop {
  const shops = shopsOf(stop);
  return shops.find((s) => s.shopId === line.shopId) ?? shops[0]!;
}

const FLAG_LABEL: Record<ConditionFlag, string> = { used: 'کارکرده', refurbished: 'ریفربیش', replica: 'کپی' };

/** Persian labels of a product's condition flags: the server's own labels, else a local fallback by flag. */
export function flagLabelsOf(x: { flags?: ConditionFlag[]; flagLabels?: string[] }): string[] {
  if (x.flagLabels && x.flagLabels.length > 0) return x.flagLabels;
  return (x.flags ?? []).map((f) => FLAG_LABEL[f] ?? f);
}
