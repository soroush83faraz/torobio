import type { Question } from '../api/types';
import { t } from '../copy/fa';
import { BidiText } from './Bdi';
import { Button } from './Button';
import { Icon } from './Icon';

interface Props {
  question: Question;
  /** Questions already answered for this item + the ones still queued. */
  answered: number;
  pending: number;
  busy?: boolean;
  onAnswer: (optionId: string) => void;
  onEnough: () => void;
  onUnsure?: () => void;
}

/** One expanded question at a time. Chips are single-select; every question is skippable. */
export function QuestionCard({ question, answered, pending, busy, onAnswer, onEnough, onUnsure }: Props) {
  const total = answered + pending;
  const labelId = `q-${question.id}-${question.itemId}`;
  return (
    <div
      data-testid="question-card"
      className="mt-3 rounded-2xl border border-accent/30 bg-accent-soft/60 p-4"
      aria-busy={busy || undefined}
    >
      <p className="text-xs font-semibold text-accent-ink">{t.question.count(answered + 1, total)}</p>
      <h3 id={labelId} className="mt-0.5 text-lg">
        <BidiText text={question.prompt} />
      </h3>
      {question.why && (
        <p className="mt-1 flex items-start gap-1.5 text-sm text-ink-soft">
          <Icon name="info" size={16} className="mt-1" />
          <span>
            <BidiText text={question.why} />
          </span>
        </p>
      )}
      <div role="radiogroup" aria-labelledby={labelId} className="mt-3 flex flex-wrap gap-2">
        {question.options.map((o) => {
          const skip = o.id === 'any';
          const unsure = o.id === 'unsure';
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={false}
              disabled={busy}
              onClick={() => (unsure && onUnsure ? onUnsure() : onAnswer(o.id))}
              className={`inline-flex min-h-touch flex-col items-center justify-center rounded-2xl border px-4 py-1 text-sm font-semibold leading-tight transition-colors disabled:opacity-60 ${
                o.label.length > 16 ? 'w-full' : ''
              } ${
                skip
                  ? 'border-transparent bg-transparent text-ink-soft underline decoration-dotted underline-offset-4 hover:bg-white/60'
                  : 'border-line-strong bg-surface text-ink hover:border-accent hover:bg-accent-soft active:bg-accent-soft'
              }`}
            >
              <span>
                <BidiText text={o.label} />
              </span>
              {o.hint && (
                <span className="text-xs font-normal text-ink-soft">
                  <BidiText text={o.hint} />
                </span>
              )}
            </button>
          );
        })}
      </div>
      {question.skippable !== false && (
        <div className="mt-3 border-t border-accent/20 pt-2">
          <Button variant="ghost" onClick={onEnough} disabled={busy} data-testid="enough">
            {t.question.enough}
          </Button>
        </div>
      )}
    </div>
  );
}
