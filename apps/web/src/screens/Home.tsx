import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { MetaResponse } from '../api/types';
import { BidiText } from '../components/Bdi';
import { IconButton } from '../components/Button';
import { Icon, type IconName } from '../components/Icon';
import { PlanSummaryCard } from '../components/PlanSummaryCard';
import { Rise, StaggerItem, StaggerList, canAnimate, ease, pressFeedback, pressFeedbackSoft } from '../components/motion';
import { t } from '../copy/fa';
import { formatJalaliDate } from '../lib/format';
import { toast } from '../components/Toast';
import { recentPlans, usePlans } from '../store/plans';
import { readFlag, useUi, writeFlag } from '../store/ui';
import { HomeMapSlot } from './home/HomeMapSlot';

const NOTE_KEY = 'ui:home-note-dismissed';

type Tint = 'red' | 'green' | 'plain';
const EXAMPLES: { label: string; text: string; icon: IconName; tint: Tint }[] = [
  { label: t.home.exampleCctv, text: t.home.exampleCctvText, icon: 'cctv', tint: 'red' },
  { label: t.home.exampleElectric, text: t.home.exampleElectricText, icon: 'bolt', tint: 'plain' },
  { label: t.home.examplePhone, text: t.home.examplePhoneText, icon: 'phone', tint: 'green' },
];

const TINT: Record<Tint, string> = {
  red: 'bg-accent-soft text-accent',
  green: 'bg-good-soft text-good-strong',
  plain: 'bg-sunken text-ink',
};

/** Splits the text at the last «،» / «و» so suggestions apply to the item being typed. */
function lastFragment(text: string): { head: string; tail: string } {
  const m = /^(.*(?:[،,\n]|\sو\s))([^،,\n]*)$/s.exec(text);
  return m ? { head: m[1]!, tail: m[2]! } : { head: '', tail: text };
}

/** «۴ دوربین…، ضبط‌کننده…، هارد… و آداپتور» -> the items, for the example cards. */
function fragments(text: string): string[] {
  return text
    .split(/،|,|\sو\s/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The empty input shows realistic sentences, one after another. Decorative: the label and hint carry meaning. */
function CyclingPlaceholder({ active }: { active: boolean }) {
  const items = t.home.placeholders;
  const [i, setI] = useState(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!active || !canAnimate()) return;
    const timer = setInterval(() => setI((x) => (x + 1) % items.length), reduced ? 5200 : 3400);
    return () => clearInterval(timer);
  }, [active, reduced, items.length]);
  if (!active) return null;
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 block p-4 text-base text-ink-soft">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={i}
          className="block"
          initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -8, filter: 'blur(4px)', transition: { duration: 0.2 } }}
          transition={{ duration: 0.45, ease: ease.out }}
        >
          {items[i]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export function Home() {
  const navigate = useNavigate();
  const create = usePlans((s) => s.create);
  const plans = usePlans((s) => s.plans);
  const last = recentPlans(plans, 1)[0];
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const notice = usePlans((s) => s.notice);
  const dismissNotice = usePlans((s) => s.dismissNotice);
  const setAbout = useUi((s) => s.setAbout);
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [noteHidden, setNoteHidden] = useState(() => readFlag(NOTE_KEY));
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api.meta().then(setMeta).catch(() => undefined);
  }, []);

  const suggestions = useMemo(() => {
    const { tail } = lastFragment(text);
    const q = tail.trim();
    if (q.length < 2 || !meta) return [];
    return meta.categories.filter((c) => c.includes(q) && c !== q).slice(0, 4);
  }, [text, meta]);

  const submit = async (value: string) => {
    const v = value.trim();
    if (!v || busy) return;
    setBusy(true);
    setError(null);
    const slowTimer = setTimeout(() => setSlow(true), 3000);
    try {
      const parsed = await api.parse({ text: v });
      if (!parsed.items.length) throw new Error('empty');
      const id = create(parsed.title, parsed.items);
      navigate(`/plan/${id}`);
      if (parsed.degraded) toast(parsed.degradedReason === 'budget' ? t.notice.degradedBudget : t.notice.degraded);
    } catch (e) {
      setError((e as { messageFa?: string }).messageFa || t.home.parseError);
      setBusy(false);
    } finally {
      clearTimeout(slowTimer);
      setSlow(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit(text);
    }
  };

  const pickExample = (value: string) => {
    setText(value);
    void submit(value);
  };

  const ready = !!text.trim();

  return (
    <div className="page pb-12 pt-3">
      {/* ---------- hero: the conversation starts here ---------- */}
      <section aria-labelledby="home-heading" className="surface-night relative overflow-hidden rounded-hero px-4 pb-5 shadow-hero">
        {/* the living map of the bazaar belt is the hero's top band; the heading is written over its fading foot */}
        <HomeMapSlot className="-mx-4 -mb-9" />
        <div className="relative">
          <Rise>
            <h1 id="home-heading" className="text-display font-black text-night-ink">
              {t.home.heading}
            </h1>
          </Rise>
          <Rise delay={0.08} as="p" className="mt-2 text-base text-night-soft">
            {t.home.sub}
          </Rise>

          <form
            className="mt-5"
            onSubmit={(e) => {
              e.preventDefault();
              void submit(text);
            }}
          >
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.55, ease: ease.out, delay: 0.14 }}
              className="relative rounded-[22px] bg-surface text-ink shadow-raised ring-1 ring-black/5 transition-shadow duration-300 focus-within:shadow-focus-light"
            >
              <label htmlFor="shopping-text" className="sr-only">
                {t.home.inputLabel}
              </label>
              <CyclingPlaceholder active={!text} />
              <textarea
                id="shopping-text"
                ref={inputRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKeyDown}
                rows={3}
                enterKeyHint="go"
                placeholder={t.home.placeholder}
                aria-describedby="home-hint"
                className="relative block min-h-[6.5rem] w-full resize-none rounded-[22px] bg-transparent p-4 pb-1 text-lg font-medium outline-none placeholder:text-transparent"
              />
              <div className="flex items-center justify-end gap-2 p-2 pt-0">
                <motion.button
                  type="submit"
                  data-testid="go"
                  disabled={!ready || busy}
                  aria-busy={busy || undefined}
                  aria-label={busy ? t.home.going : t.home.sendLabel}
                  {...(ready && !busy ? pressFeedback : {})}
                  className={`inline-flex min-h-[52px] items-center gap-2 rounded-[16px] px-5 text-base font-extrabold transition-colors duration-200 disabled:cursor-not-allowed ${
                    ready || busy
                      ? 'bg-accent text-white shadow-[0_8px_18px_-8px_rgba(183,24,34,0.8)] hover:bg-accent-strong'
                      : 'bg-sunken text-ink-soft'
                  }`}
                >
                  {busy ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
                      {t.home.going}
                    </>
                  ) : (
                    <>
                      {t.home.go}
                      <Icon name="arrow-forward" size={20} />
                    </>
                  )}
                </motion.button>
              </div>
            </motion.div>

            <p id="home-hint" className="mt-2 px-1 text-sm text-night-soft">
              {t.home.hint}
            </p>

            <AnimatePresence initial={false}>
              {suggestions.length > 0 && (
                <motion.div
                  key="suggest"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, transition: { duration: 0.12 } }}
                  className="mt-3 flex flex-wrap gap-2"
                  aria-label={t.home.suggestions}
                >
                  {suggestions.map((s) => (
                    <motion.button
                      key={s}
                      type="button"
                      {...pressFeedback}
                      onClick={() => {
                        const { head } = lastFragment(text);
                        setText(`${head}${s}`);
                        inputRef.current?.focus();
                      }}
                      className="inline-flex min-h-touch items-center gap-1.5 rounded-chip border border-night-ink/25 bg-night-ink/10 px-4 text-sm font-semibold text-night-ink hover:bg-night-ink/20"
                    >
                      <Icon name="plus" size={16} />
                      <BidiText text={s} />
                    </motion.button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            {error && (
              <p role="alert" data-testid="parse-error" className="mt-3 rounded-control bg-danger-soft px-4 py-2 text-sm font-semibold text-danger">
                {error}
              </p>
            )}
            {busy && slow && (
              <p role="status" className="mt-3 rounded-control bg-night-ink/10 px-4 py-2 text-sm text-night-ink">
                {t.notice.parseSlow}
              </p>
            )}
          </form>
        </div>
      </section>

      {notice && notice.droppedLegacy > 0 && (
        <aside role="note" data-testid="legacy-notice" className="mt-5 flex items-start gap-1 rounded-card bg-amber-soft ps-4 text-sm text-amber-ink">
          <p className="flex-1 py-3">{t.notice.legacyDropped(notice.droppedLegacy)}</p>
          <IconButton icon="close" label={t.home.dismissNote} onClick={dismissNotice} />
        </aside>
      )}

      {last && (
        <section className="mt-7" aria-labelledby="resume-h" data-testid="resume-card">
          <Rise delay={0.2}>
            <h2 id="resume-h" className="mb-2 text-base font-extrabold text-ink">
              {t.home.resumeHeading}
            </h2>
            <PlanSummaryCard plan={last} />
          </Rise>
        </section>
      )}

      {/* ---------- example intents ---------- */}
      <section className="mt-8" aria-labelledby="examples-h">
        <h2 id="examples-h" className="text-base font-extrabold text-ink">
          {t.home.examples}
        </h2>
        <StaggerList className="mt-3 space-y-3" step={0.07}>
          {EXAMPLES.map((e) => {
            const parts = fragments(e.text);
            return (
              <StaggerItem key={e.label}>
                <motion.button
                  type="button"
                  {...(busy ? {} : pressFeedbackSoft)}
                  onClick={() => pickExample(e.text)}
                  disabled={busy}
                  className="group flex w-full items-start gap-3 rounded-card border border-line bg-surface p-4 text-start shadow-card transition-[box-shadow,border-color] duration-200 hover:border-line-strong/50 hover:shadow-raised disabled:opacity-60"
                >
                  <span className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-control ${TINT[e.tint]}`}>
                    <Icon name={e.icon} size={24} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-base font-extrabold text-ink">{e.label}</span>
                      <span className="num shrink-0 text-sm text-ink-soft">{t.home.exampleCount(parts.length)}</span>
                    </span>
                    <span className="mt-2 flex flex-wrap gap-1.5">
                      {parts.map((p) => (
                        <span key={p} className="rounded-lg bg-sunken px-2 text-sm leading-7 text-ink">
                          <BidiText text={p} />
                        </span>
                      ))}
                    </span>
                  </span>
                  <Icon
                    name="arrow-forward"
                    size={20}
                    className="mt-3.5 text-ink-soft transition-transform duration-200 group-hover:-translate-x-1"
                  />
                </motion.button>
              </StaggerItem>
            );
          })}
        </StaggerList>
      </section>

      {!noteHidden && meta && meta.snapshotDate && (
        <aside className="mt-6 flex items-start gap-1 border-t border-line pt-3 text-sm text-ink-soft">
          <Icon name="info" size={18} className="mt-1 shrink-0" />
          <div className="flex-1 ps-1">
            <p>{t.home.dataNote(meta.snapshotLabel || formatJalaliDate(`${meta.snapshotDate}T12:00:00Z`), meta.areas.join('، '))}</p>
            <button
              type="button"
              onClick={() => setAbout(true)}
              className="-ms-2 inline-flex min-h-touch items-center gap-1 rounded-control px-2 font-bold text-accent-ink transition-colors hover:bg-accent-soft"
            >
              {t.home.dataMore}
              <Icon name="chevron-forward" size={16} />
            </button>
          </div>
          <IconButton
            icon="close"
            label={t.home.dismissNote}
            onClick={() => {
              writeFlag(NOTE_KEY, true);
              setNoteHidden(true);
            }}
          />
        </aside>
      )}
    </div>
  );
}
