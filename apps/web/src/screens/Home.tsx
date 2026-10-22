import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { MetaResponse } from '../api/types';
import { BidiText } from '../components/Bdi';
import { Button, IconButton } from '../components/Button';
import { Chip } from '../components/Chip';
import { Icon } from '../components/Icon';
import { PlanSummaryCard } from '../components/PlanSummaryCard';
import { t } from '../copy/fa';
import { formatJalaliDate } from '../lib/format';
import { toast } from '../components/Toast';
import { recentPlans, usePlans } from '../store/plans';
import { readFlag, writeFlag } from '../store/ui';

const NOTE_KEY = 'ui:home-note-dismissed';

const EXAMPLES = [
  { label: t.home.exampleCctv, text: t.home.exampleCctvText },
  { label: t.home.exampleElectric, text: t.home.exampleElectricText },
  { label: t.home.examplePhone, text: t.home.examplePhoneText },
];

/** Splits the text at the last «،» / «و» so suggestions apply to the item being typed. */
function lastFragment(text: string): { head: string; tail: string } {
  const m = /^(.*(?:[،,\n]|\sو\s))([^،,\n]*)$/s.exec(text);
  return m ? { head: m[1]!, tail: m[2]! } : { head: '', tail: text };
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
      if (parsed.degraded) toast(t.notice.degraded);
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

  return (
    <div className="page pb-10 pt-6">
      <h1 id="home-heading" className="text-2xl font-extrabold leading-snug">
        {t.home.heading}
      </h1>

      <form
        className="mt-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(text);
        }}
      >
        <div className="card overflow-hidden focus-within:ring-2 focus-within:ring-accent">
          <label htmlFor="shopping-text" className="sr-only">
            {t.home.inputLabel}
          </label>
          <textarea
            id="shopping-text"
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            rows={4}
            enterKeyHint="go"
            placeholder={t.home.placeholder}
            aria-describedby="home-hint"
            className="block w-full resize-none rounded-card bg-transparent p-4 text-base outline-none"
          />
          <div className="flex items-center justify-between gap-2 border-t border-line bg-canvas/60 p-2">
            <p id="home-hint" className="px-2 text-sm text-ink-soft">
              {t.home.hint}
            </p>
          </div>
        </div>

        {suggestions.length > 0 && (
          <div className="mt-3" aria-label={t.home.suggestions}>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <Chip
                  key={s}
                  icon="plus"
                  onClick={() => {
                    const { head } = lastFragment(text);
                    setText(`${head}${s}`);
                    inputRef.current?.focus();
                  }}
                >
                  <BidiText text={s} />
                </Chip>
              ))}
            </div>
          </div>
        )}

        {error && (
          <p role="alert" data-testid="parse-error" className="mt-3 rounded-xl bg-amber-soft px-4 py-2 text-sm text-amber-ink">
            {error}
          </p>
        )}
        {busy && slow && (
          <p role="status" className="mt-3 rounded-xl bg-sunken px-4 py-2 text-sm text-ink-soft">
            {t.notice.parseSlow}
          </p>
        )}

        <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={!text.trim()} className="mt-4" data-testid="go">
          {busy ? t.home.going : t.home.go}
          {!busy && <Icon name="arrow-forward" size={20} />}
        </Button>
      </form>

      <section className="mt-8" aria-labelledby="examples-h">
        <h2 id="examples-h" className="text-base text-ink-soft">
          {t.home.examples}
        </h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {EXAMPLES.map((e) => (
            <Chip key={e.label} onClick={() => pickExample(e.text)} disabled={busy}>
              {e.label}
            </Chip>
          ))}
        </div>
      </section>

      {notice && notice.droppedLegacy > 0 && (
        <aside role="note" data-testid="legacy-notice" className="mt-6 flex items-start gap-1 rounded-card bg-amber-soft ps-4 text-sm text-amber-ink">
          <p className="flex-1 py-3">{t.notice.legacyDropped(notice.droppedLegacy)}</p>
          <IconButton icon="close" label={t.home.dismissNote} onClick={dismissNotice} />
        </aside>
      )}

      {last && (
        <section className="mt-8" aria-labelledby="resume-h" data-testid="resume-card">
          <h2 id="resume-h" className="mb-2 text-base text-ink-soft">
            {t.home.resumeHeading}
          </h2>
          <PlanSummaryCard plan={last} />
        </section>
      )}

      {!noteHidden && meta && meta.snapshotDate && (
        <aside className="mt-8 flex items-start gap-1 rounded-card bg-sunken ps-4 text-sm text-ink-soft">
          <p className="flex-1 py-3">
            {t.home.dataNote(meta.snapshotLabel || formatJalaliDate(`${meta.snapshotDate}T12:00:00Z`), meta.areas.join('، '))}
          </p>
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
