import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { AssistChip, AssistRequest, AssistResult, RequirementState } from '../api/types';
import { BidiText, Interp } from '../components/Bdi';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { Icon } from '../components/Icon';
import { t } from '../copy/fa';

export type AssistContext = NonNullable<AssistRequest['context']>;

interface Props {
  open: boolean;
  state: RequirementState;
  /** The card the sheet was opened from: a shop («بدون این مغازه») or an item (a question). */
  context?: AssistContext;
  /** Persian name of the context shop, for the line under the title. */
  contextLabel?: string;
  /** Runs once when the sheet opens, e.g. the «مطمئن نیستم» explanation. */
  autoText?: string;
  onClose: () => void;
  /** The assistant changed the requirement state: the parent applies `newState`, shows the diff and «برگرداندن». */
  onApply: (result: AssistResult) => void;
}

const CHIPS: { id: AssistChip; label: string }[] = [
  { id: 'cheaper', label: t.assistant.cheaper },
  { id: 'closer', label: t.assistant.closer },
  { id: 'fewer_stops', label: t.assistant.fewerStops },
  { id: 'only_open', label: t.assistant.onlyOpen },
  { id: 'without_shop', label: t.assistant.withoutShop },
];

/**
 * v3 6.9: chips first, free text second. Everything is decided by the server (`/api/assist`); the sheet only
 * sends the request and shows the answer. A change closes the sheet (the diff banner takes over); anything else
 * (nothing to change, not supported, a choice to make) stays here with the server's Persian sentence.
 */
export function AssistantSheet({ open, state, context, contextLabel, autoText, onClose, onApply }: Props) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AssistResult | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const ran = useRef<string | null>(null);
  const seq = useRef(0);

  const run = async (req: Omit<AssistRequest, 'state'>) => {
    const mine = ++seq.current;
    setBusy(true);
    setFailed(null);
    try {
      const r = await api.assist({ state, ...req, context: req.context ?? context });
      if (mine !== seq.current) return; // the sheet was closed or another request started
      if (r.changed) {
        onApply(r);
        setResult(null);
        onClose();
      } else {
        setResult(r);
      }
    } catch (e) {
      if (mine !== seq.current) return;
      const fa = (e as { messageFa?: string }).messageFa;
      setFailed(fa && /[؀-ۿ]/.test(fa) ? fa : t.assistant.error);
    } finally {
      if (mine === seq.current) setBusy(false);
    }
  };

  useEffect(() => {
    if (!open) {
      seq.current += 1;
      ran.current = null;
      setResult(null);
      setFailed(null);
      setBusy(false);
      setText('');
      return;
    }
    if (autoText && ran.current !== autoText) {
      ran.current = autoText;
      void run({ text: autoText });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, autoText]);

  return (
    <BottomSheet open={open} onClose={onClose} title={t.assistant.title}>
      <p className="mb-1 text-base font-semibold">{t.assistant.prompt}</p>
      {contextLabel && (
        <p data-testid="assist-context" className="mb-3 text-sm text-ink-soft [overflow-wrap:anywhere]">
          <Interp tpl={t.assistant.forShop} args={[contextLabel]} />
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {CHIPS.map((c) => (
          <Chip key={c.id} disabled={busy} onClick={() => run({ chip: c.id })} data-testid={`assist-${c.id}`}>
            {c.label}
          </Chip>
        ))}
      </div>
      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim() && !busy) void run({ text });
        }}
      >
        <label htmlFor="assist-text" className="sr-only">
          {t.assistant.title}
        </label>
        <input
          id="assist-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t.assistant.freePlaceholder}
          className="min-h-touch min-w-0 flex-1 rounded-xl border border-line-strong bg-surface px-3"
        />
        <Button type="submit" variant="primary" disabled={!text.trim() || busy} icon="send" aria-label={t.assistant.send}>
          <span className="sr-only">{t.assistant.send}</span>
        </Button>
      </form>
      <div aria-live="polite" className="mt-4 space-y-3">
        {busy && <p className="text-sm text-ink-soft">{t.assistant.working}</p>}
        {failed && !busy && (
          <p data-testid="assist-error" className="rounded-xl bg-amber-soft px-4 py-3 text-sm text-amber-ink">
            {failed}
          </p>
        )}
        {result && !busy && (
          <>
            {result.degraded && (
              <p data-testid="assist-degraded" className="rounded-xl bg-sunken px-4 py-2 text-sm text-ink-soft">
                {t.assistant.degraded}
              </p>
            )}
            <div
              data-testid="assist-result"
              data-kind={!result.supported ? 'unsupported' : 'unchanged'}
              className={`flex items-start gap-2 rounded-xl px-4 py-3 text-base ${result.supported ? 'bg-accent-soft' : 'bg-amber-soft'}`}
            >
              <Icon name={result.supported ? 'info' : 'alert'} size={18} className="mt-1 shrink-0" />
              <p className="min-w-0 [overflow-wrap:anywhere]">
                <BidiText text={result.messageFa} />
              </p>
            </div>
            {result.choices && result.choices.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-semibold">{t.assistant.pickOne}</p>
                <div className="flex flex-wrap gap-2">
                  {result.choices.map((c) => (
                    <Chip key={c.label} disabled={busy} onClick={() => run(c.request)} data-testid="assist-choice">
                      <BidiText text={c.label} />
                    </Chip>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </BottomSheet>
  );
}
