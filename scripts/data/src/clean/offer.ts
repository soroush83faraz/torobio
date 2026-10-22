import { normalizeFa } from '@app/core';

/** Data-hygiene thresholds (PLAN B1.6). */
export const PRICE_MIN = 10_000;
export const PRICE_MAX = 1e12;

export type PriceFlag = 'missing' | 'placeholder' | 'outlier';

export function cleanPrice(raw: string | null | undefined): { price: number | null; flag: PriceFlag | null } {
  if (raw == null || raw === '' || raw === 'null') return { price: null, flag: 'missing' };
  const v = Number(raw);
  if (!Number.isFinite(v)) return { price: null, flag: 'missing' };
  if (v < PRICE_MIN) return { price: null, flag: 'placeholder' };
  if (v > PRICE_MAX) return { price: null, flag: 'outlier' };
  return { price: Math.round(v), flag: null };
}

export type WarrantyCode = 'on_site_test' | 'company' | 'authenticity' | 'none' | 'other';

interface RawWarranty {
  description?: string | null;
  period_months?: number | null;
  provider?: string | null;
}

const clean = (s: string | null | undefined): string | null => {
  if (s == null) return null;
  const t = String(s).trim();
  return t === '' || t === 'None' || t === 'null' ? null : t;
};

const DURATION_RE = /(?:\d+|یک|دو|سه|شش|هجده|هیجده|دوازده|بیست و چهار|سی و شش)\s*(?:ماه|ماهه|سال|ساله)(?![\u0620-\u064A\u066E-\u06D3\u06FA-\u06FF])|یکسال|یک سال|دوسال|دو ساله|یکساله/;

/**
 * Warranty -> small code + original text + months.
 * Priority: on_site_test > none > company > authenticity > other.
 * - on_site_test: provider «تست و تحویل در حضور مشتری» (or the same words in the description)
 * - none: provider «بدون گارانتی», or description says «بدون گارانتی» / starts with «ندارد»
 * - company: provider «شرکتی» or any named guarantor company, or a period in months, or a
 *   description naming a months/years guarantee
 * - authenticity: only authenticity / physical-health guarantee («اصالت», «اصل بودن», «سلامت فیزیکی»)
 * - other: anything else (return windows, price guarantees, ...)
 */
export function normalizeWarranty(raw: unknown): { code: WarrantyCode | null; text: string | null; months: number | null } {
  if (!raw || typeof raw !== 'object') return { code: null, text: null, months: null };
  const w = raw as RawWarranty;
  const provider = clean(w.provider);
  const desc = clean(w.description);
  const months = typeof w.period_months === 'number' && w.period_months > 0 ? w.period_months : null;
  const text = desc ?? provider;
  if (!provider && !desc && months == null) return { code: null, text: null, months: null };
  const p = provider ? normalizeFa(provider) : '';
  const d = desc ? normalizeFa(desc) : '';
  let code: WarrantyCode;
  const durationOnly = new RegExp(`^(?:گارانتی\\s*)?(?:${DURATION_RE.source})(?:\\s*گارانتی)?$`).test(d);
  if (p === 'تست و تحویل در حضور مشتری' || /تست و تحویل در حضور مشتری|تست در حضور مشتری/.test(d)) code = 'on_site_test';
  else if (p === 'بدون گارانتی' || /بدون گارانتی|بدون ضمانت/.test(d) || /^ندارد/.test(d)) code = 'none';
  else if (p === 'شرکتی' || (p && p !== 'انتخاب سرویس حامی') || months != null || durationOnly || (/گارانتی|ضمانت/.test(d) && DURATION_RE.test(d))) code = 'company';
  else if (/اصالت|اصل بودن|سلامت فیزیکی|اورجینال/.test(d)) code = 'authenticity';
  else code = 'other';
  let m = months;
  if (m == null && code === 'company') m = monthsFromText(d);
  return { code, text: text ?? null, months: m };
}

const WORD_NUM: Record<string, number> = { 'یک': 1, 'دو': 2, 'سه': 3, 'شش': 6, 'دوازده': 12, 'هجده': 18, 'هیجده': 18 };

/** A single unambiguous guarantee period in the text («18 ماهه», «2 سال», «یکسال»), else null. */
export function monthsFromText(d: string): number | null {
  const vals = new Set<number>();
  for (const m of d.matchAll(/(\d{1,3}|یک|دو|سه|شش|دوازده|هجده|هیجده)\s*(ماهه|ماه|ساله|سال)(?![\u0620-\u064A\u066E-\u06D3\u06FA-\u06FF])/g)) {
    const n = /^\d+$/.test(m[1] as string) ? Number(m[1]) : (WORD_NUM[m[1] as string] ?? NaN);
    if (!Number.isFinite(n)) continue;
    vals.add(/سال/.test(m[2] as string) ? n * 12 : n);
  }
  if (/یکسال|یکساله/.test(d)) vals.add(12);
  if (/دوسال|دوساله/.test(d)) vals.add(24);
  // «7 روز مهلت تست و 6 ماه گارانتی» has one months value; «10 سال خدمات» next to «2 سال گارانتی» is ambiguous
  const ok = [...vals].filter((v) => v >= 1 && v <= 120);
  return ok.length === 1 ? (ok[0] as number) : null;
}
