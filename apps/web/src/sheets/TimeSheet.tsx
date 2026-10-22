import { useEffect, useMemo, useState } from 'react';
import type { VisitTime, VisitWindow } from '../api/types';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { t } from '../copy/fa';
import { toPersianDigits } from '../lib/format';
import { parseClock, upcomingDays } from '../lib/visit';

interface Props {
  open: boolean;
  visit: VisitTime;
  onClose: () => void;
  onApply: (v: VisitTime) => void;
}

const WINDOWS: { value: VisitWindow; label: string }[] = [
  { value: 'any', label: t.visit.any },
  { value: 'morning', label: t.visit.morning },
  { value: 'noon', label: t.visit.noon },
  { value: 'evening', label: t.visit.evening },
  { value: 'exact', label: t.visit.exact },
];

/** v3 6.4: day and optional time. Default «هر زمان» changes nothing. */
export function TimeSheet({ open, visit, onClose, onApply }: Props) {
  const [draft, setDraft] = useState<VisitTime>(visit);
  const [pickDay, setPickDay] = useState(visit.day === 'date');
  const [clock, setClock] = useState(visit.time ? toPersianDigits(visit.time) : '');
  const [clockError, setClockError] = useState(false);
  const days = useMemo(() => upcomingDays(14), []);

  useEffect(() => {
    if (open) {
      setDraft(visit);
      setPickDay(visit.day === 'date');
      setClock(visit.time ? toPersianDigits(visit.time) : '');
      setClockError(false);
    }
  }, [open, visit]);

  const apply = () => {
    if (draft.window === 'exact') {
      const parsed = parseClock(clock);
      if (!parsed) {
        setClockError(true);
        return;
      }
      onApply({ ...draft, time: parsed });
    } else {
      onApply({ day: draft.day, date: draft.date, window: draft.window });
    }
    onClose();
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={t.visit.sheetTitle}
      footer={
        <div className="flex gap-2">
          <Button variant="primary" size="lg" className="flex-1" onClick={apply} data-testid="apply-visit">
            {t.visit.apply}
          </Button>
        </div>
      }
    >
      <p className="-mt-1 mb-3 text-sm text-ink-soft">{t.visit.optional}</p>

      <fieldset>
        <legend className="mb-2 text-base font-bold">{t.visit.day}</legend>
        <div role="radiogroup" className="flex flex-wrap gap-2">
          <Chip mode="single" selected={draft.day === 'today'} onClick={() => { setDraft({ ...draft, day: 'today', date: undefined }); setPickDay(false); }}>
            {t.visit.today}
          </Chip>
          <Chip mode="single" selected={draft.day === 'tomorrow'} onClick={() => { setDraft({ ...draft, day: 'tomorrow', date: undefined }); setPickDay(false); }}>
            {t.visit.tomorrow}
          </Chip>
          <Chip mode="single" selected={draft.day === 'date' || pickDay} onClick={() => setPickDay(true)}>
            {t.visit.pickDay}
          </Chip>
        </div>
        {pickDay && (
          <div role="radiogroup" aria-label={t.visit.dateLabel} className="mt-3 flex flex-wrap gap-2">
            {days.map((d) => (
              <Chip
                key={d.iso}
                mode="single"
                selected={draft.day === 'date' && draft.date === d.iso}
                onClick={() => setDraft({ ...draft, day: 'date', date: d.iso })}
              >
                {d.label}
              </Chip>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className="mt-5">
        <legend className="mb-2 text-base font-bold">{t.visit.time}</legend>
        <div role="radiogroup" className="flex flex-wrap gap-2">
          {WINDOWS.map((w) => (
            <Chip key={w.value} mode="single" selected={draft.window === w.value} onClick={() => setDraft({ ...draft, window: w.value })}>
              {w.label}
            </Chip>
          ))}
        </div>
        {draft.window === 'exact' && (
          <div className="mt-3">
            <label htmlFor="exact-time" className="mb-1 block text-sm font-semibold">
              {t.visit.exactLabel}
            </label>
            <input
              id="exact-time"
              dir="ltr"
              inputMode="numeric"
              autoComplete="off"
              value={clock}
              onChange={(e) => {
                setClock(e.target.value);
                setClockError(false);
              }}
              placeholder={toPersianDigits('19:30')}
              aria-invalid={clockError}
              aria-describedby={clockError ? 'clock-err' : undefined}
              className="min-h-touch w-32 rounded-xl border border-line-strong bg-surface px-3 text-center text-lg"
            />
            {clockError && (
              <p id="clock-err" role="alert" className="mt-1 text-sm text-amber-ink">
                {t.visit.invalidTime}
              </p>
            )}
          </div>
        )}
      </fieldset>

      <p className="mt-5 rounded-xl bg-sunken px-4 py-3 text-sm text-ink-soft">{t.visit.hint}</p>
      <div className="mt-2">
        <Button variant="ghost" onClick={() => { onApply({ day: 'today', window: 'any' }); onClose(); }}>
          {t.visit.reset}
        </Button>
      </div>
    </BottomSheet>
  );
}
