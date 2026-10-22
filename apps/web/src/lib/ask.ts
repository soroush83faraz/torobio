import type { CompatLine, StopLine } from '../api/types';

/**
 * «از فروشنده بپرس» for one bought line, exactly as the server worded it: `StopLine.askSeller` (per-role wording
 * already applied). Only a server that sends no `askSeller` for the line falls back to the plan's
 * `CompatLine.askSellerByItem[itemId]` (never composed here). Stated lines ask nothing.
 */
export function askForLine(line: Pick<StopLine, 'itemId' | 'askSeller'>, compat: readonly CompatLine[] = []): string[] {
  if (line.askSeller && line.askSeller.length > 0) return line.askSeller;
  const out: string[] = [];
  for (const c of compat) {
    if (c.level === 'stated') continue;
    const q = c.askSellerByItem?.[line.itemId];
    if (q && !out.includes(q)) out.push(q);
  }
  return out;
}
