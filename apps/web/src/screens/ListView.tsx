import { useState } from 'react';
import type { ItemResolution, Requirement } from '../api/types';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { ItemCard } from '../components/ItemCard';
import { QuestionCard } from '../components/QuestionCard';
import { t } from '../copy/fa';
import { isDeadEnd } from '../lib/items';
import type { SavedPlan } from '../store/plans';

interface Props {
  plan: SavedPlan;
  resolutions: ItemResolution[];
  busy: boolean;
  activeId: string | null;
  setActiveId: (id: string) => void;
  onAnswer: (itemId: string, qid: string, opt: string) => void;
  onEnough: (itemId: string) => void;
  onSettleAll: () => void;
  onChange: (itemId: string) => void;
  onRemove: (itemId: string) => void;
  onDetachChip: (itemId: string, key: string) => void;
  onIncludeCondition: (itemId: string) => void;
  onRelax: (itemId: string, attr: string) => void;
  onPickModel: (itemId: string, productId: string) => void;
  onAdd: (text: string) => Promise<boolean>;
  onUnsure: (itemId: string, question: string) => void;
  /** The plan's marker («ناسازگاری دارد» / «بدون تأیید سازگاری»): the green «all ready» strip is never shown with one. */
  marker?: string;
  /** Not-found item: the user picked suggested category `index` (re-sends the item with that category). */
  onPickNearby: (itemId: string, index: number) => void;
}

/** «فهرست»: requirements and questions. Only one question card is expanded at a time. */
export function ListView({
  plan,
  resolutions,
  busy,
  activeId,
  setActiveId,
  onAnswer,
  onEnough,
  onSettleAll,
  onChange,
  onRemove,
  onDetachChip,
  onIncludeCondition,
  onRelax,
  onPickModel,
  onAdd,
  onUnsure,
  marker,
  onPickNearby,
}: Props) {
  const pending = resolutions.filter((r) => r.state === 'needs_info');
  const missing = resolutions.filter((r) => r.state === 'not_found' || isDeadEnd(r));
  const byId = new Map<string, Requirement>(plan.requirements.map((r) => [r.id, r]));
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [addBusy, setAddBusy] = useState(false);

  const submitAdd = async () => {
    if (!draft.trim() || addBusy) return;
    setAddBusy(true);
    const ok = await onAdd(draft);
    setAddBusy(false);
    if (ok) {
      setDraft('');
      setAdding(false);
    }
  };

  return (
    <section aria-labelledby="list-h">
      <h2 id="list-h" className="sr-only">
        {t.list.heading}
      </h2>

      {pending.length > 0 ? (
        <div
          data-testid="pending-strip"
          className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-soft px-4 py-2 text-amber-ink"
        >
          <p className="text-sm font-bold">{t.list.pendingStrip(pending.length)}</p>
          <Button variant="secondary" onClick={onSettleAll} data-testid="settle-all" className="!min-h-touch">
            {t.list.settleAll}
          </Button>
        </div>
      ) : marker ? (
        <p data-testid="conflict-strip" className="mt-2 flex items-start gap-2 rounded-xl border border-amber bg-amber-soft px-4 py-2 text-sm font-semibold text-amber-ink">
          <Icon name="alert" size={16} className="mt-1 shrink-0" />
          {t.list.markerStrip(marker)}
        </p>
      ) : missing.length > 0 ? (
        <p data-testid="missing-strip" className="mt-2 flex items-start gap-2 rounded-xl bg-sunken px-4 py-2 text-sm font-semibold">
          <Icon name="info" size={16} className="mt-1 shrink-0" />
          {t.list.notFoundStrip(missing.length)}
        </p>
      ) : (
        <p data-testid="all-ready-strip" className="mt-2 flex items-center gap-2 rounded-xl bg-accent-soft px-4 py-2 text-sm font-semibold text-accent-ink">
          <Icon name="check" size={16} />
          {t.list.allReady}
        </p>
      )}

      <ul className="mt-3 space-y-3" aria-busy={busy || undefined}>
        {resolutions.map((res) => {
          const req = byId.get(res.itemId);
          if (!req) return null;
          const isActive = activeId === res.itemId && !!res.question;
          const answered = Object.keys(plan.answers[req.id] ?? {}).length;
          return (
            <li key={req.id}>
              <ItemCard
                req={req}
                res={res}
                active={isActive}
                onChange={() => onChange(req.id)}
                onRemove={() => onRemove(req.id)}
                onActivate={() => setActiveId(req.id)}
                onDetachChip={(key) => onDetachChip(req.id, key)}
                onIncludeCondition={() => onIncludeCondition(req.id)}
                onRelax={(attr) => onRelax(req.id, attr)}
                onPickModel={(pid) => onPickModel(req.id, pid)}
                onPickNearby={(i) => onPickNearby(req.id, i)}
              >
                {res.question && (
                  <QuestionCard
                    question={res.question}
                    answered={answered}
                    pending={res.pendingQuestions}
                    busy={busy}
                    onAnswer={(opt) => onAnswer(req.id, res.question!.id, opt)}
                    onEnough={() => onEnough(req.id)}
                    onUnsure={() => onUnsure(req.id, res.question!.prompt)}
                  />
                )}
              </ItemCard>
            </li>
          );
        })}
      </ul>

      <div className="mt-3">
        {adding ? (
          <form
            className="card flex flex-col gap-2 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submitAdd();
            }}
          >
            <label htmlFor="add-item" className="sr-only">
              {t.list.addItem}
            </label>
            <input
              id="add-item"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t.list.addPlaceholder}
              enterKeyHint="done"
              className="min-h-touch w-full rounded-xl border border-line-strong bg-surface px-3"
              data-autofocus
              autoFocus
            />
            <div className="flex gap-2">
              <Button type="submit" variant="primary" loading={addBusy} disabled={!draft.trim()} className="flex-1">
                {t.list.addConfirm}
              </Button>
              <Button onClick={() => setAdding(false)}>{t.workspace.menu.cancel}</Button>
            </div>
          </form>
        ) : (
          <Button variant="secondary" icon="plus" block onClick={() => setAdding(true)} data-testid="add-item">
            {t.list.addItem}
          </Button>
        )}
      </div>
    </section>
  );
}
