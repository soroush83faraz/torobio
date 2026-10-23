import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ItemResolution, Requirement } from '../api/types';
import { AssistantAvatar } from '../components/AssistantAvatar';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { ItemCard } from '../components/ItemCard';
import { QuestionCard } from '../components/QuestionCard';
import { AnimatedCheck, StaggerItem, StaggerList, TypingDots, ease, pressFeedbackSoft } from '../components/motion';
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
  /** Shown under the assistant's opening message (the «کجا برم؟» teaser when every question is settled). */
  teaser?: ReactNode;
}

/**
 * «فهرست» as a conversation with the assistant: an opening status message (what it still needs to know), then
 * each item as a rich card; under the item being discussed, the assistant's question bubble. Only one question is
 * open at a time; when it is answered the next one appears (and is scrolled into view).
 */
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
  teaser,
}: Props) {
  const pending = resolutions.filter((r) => r.state === 'needs_info');
  const missing = resolutions.filter((r) => r.state === 'not_found' || isDeadEnd(r));
  const byId = new Map<string, Requirement>(plan.requirements.map((r) => [r.id, r]));
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const questionsLeft = pending.reduce((sum, r) => sum + Math.max(1, r.pendingQuestions || 0), 0);
  useFollowQuestion(activeId);

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

  const status = pending.length > 0 ? 'asking' : marker ? 'marker' : missing.length > 0 ? 'missing' : 'ready';
  const statusText =
    status === 'asking' ? t.agent.asking(questionsLeft) : status === 'marker' ? t.agent.marker : status === 'missing' ? t.agent.missing : t.agent.ready;

  return (
    <section aria-labelledby="list-h">
      {/* ---------- the assistant's opening message ---------- */}
      <div className="flex items-start gap-3">
        <AssistantAvatar size={44} thinking={busy || status === 'asking'} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-extrabold text-ink">
            {t.agent.name}
            {busy && <TypingDots />}
          </p>
          <motion.div layout="size" className="mt-1 overflow-hidden rounded-[22px] rounded-ss-md border border-line bg-surface shadow-card">
            <div role="status" aria-live="polite" className="px-4 pb-3 pt-2.5">
              <AnimatePresence mode="wait" initial={false}>
                <motion.p
                  key={status + (status === 'asking' ? questionsLeft : '')}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6, transition: { duration: 0.15 } }}
                  transition={{ duration: 0.35, ease: ease.out }}
                  className="text-base font-semibold leading-relaxed"
                >
                  {statusText}
                </motion.p>
              </AnimatePresence>
            </div>

            {pending.length > 0 ? (
              <div data-testid="pending-strip" className="flex flex-col gap-2 border-t border-line bg-amber-soft/70 px-4 py-3 text-amber-ink">
                <p className="flex items-center gap-2 text-sm font-bold">
                  <Icon name="question" size={18} />
                  {t.list.pendingStrip(pending.length)}
                </p>
                <Button variant="secondary" onClick={onSettleAll} data-testid="settle-all" className="!min-h-touch self-start">
                  {t.list.settleAll}
                </Button>
              </div>
            ) : marker ? (
              <p
                data-testid="conflict-strip"
                className="flex items-start gap-2 border-t border-amber/40 bg-amber-soft px-4 py-3 text-sm font-semibold text-amber-ink"
              >
                <Icon name="alert" size={16} className="mt-1 shrink-0" />
                {t.list.markerStrip(marker)}
              </p>
            ) : missing.length > 0 ? (
              <p data-testid="missing-strip" className="flex items-start gap-2 border-t border-line bg-sunken px-4 py-3 text-sm font-semibold">
                <Icon name="info" size={16} className="mt-1 shrink-0" />
                {t.list.notFoundStrip(missing.length)}
              </p>
            ) : (
              <p data-testid="all-ready-strip" className="flex items-center gap-2 border-t border-accent/15 bg-accent-soft px-4 py-3 text-sm font-bold text-accent-ink">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent text-white">
                  <AnimatedCheck size={14} delay={0.15} />
                </span>
                {t.list.allReady}
              </p>
            )}
          </motion.div>
        </div>
      </div>

      {teaser}

      {/* ---------- the items ---------- */}
      <div className="mt-7 flex items-baseline justify-between gap-2">
        <h2 id="list-h" className="text-lg font-extrabold">
          {t.list.heading}
        </h2>
        <span className="num text-sm text-ink-soft">{t.agent.itemCount(resolutions.length)}</span>
      </div>

      <StaggerList className="mt-3 space-y-4" aria-busy={busy || undefined}>
        {resolutions.map((res) => {
          const req = byId.get(res.itemId);
          if (!req) return null;
          const isActive = activeId === res.itemId && !!res.question;
          const answered = Object.keys(plan.answers[req.id] ?? {}).length;
          return (
            <StaggerItem key={req.id} layout>
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
            </StaggerItem>
          );
        })}
      </StaggerList>

      {/* ---------- composer: add another item ---------- */}
      <div className="mt-4">
        <AnimatePresence mode="wait" initial={false}>
          {adding ? (
            <motion.form
              key="form"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              transition={{ duration: 0.3, ease: ease.out }}
              className="flex flex-col gap-2 rounded-card border border-line bg-surface p-3 shadow-raised"
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
                className="min-h-[52px] w-full rounded-control border border-line-strong/50 bg-canvas px-4 text-base outline-none transition-shadow focus:border-accent focus:shadow-focus"
                data-autofocus
                autoFocus
              />
              <div className="flex gap-2">
                <Button type="submit" variant="primary" loading={addBusy} disabled={!draft.trim()} className="flex-1">
                  {t.list.addConfirm}
                </Button>
                <Button onClick={() => setAdding(false)}>{t.workspace.menu.cancel}</Button>
              </div>
            </motion.form>
          ) : (
            <motion.button
              key="add"
              type="button"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
              {...pressFeedbackSoft}
              onClick={() => setAdding(true)}
              data-testid="add-item"
              className="flex min-h-14 w-full items-center gap-3 rounded-card border border-dashed border-line-strong/60 bg-surface/60 px-4 text-base font-bold text-accent-ink transition-colors hover:border-accent hover:bg-accent-soft/50"
            >
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft">
                <Icon name="plus" size={18} />
              </span>
              {t.list.addItem}
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}

/** When the open question moves to another item (the previous one was answered), bring the new bubble into view. */
function useFollowQuestion(activeId: string | null) {
  const prev = useRef(activeId);
  const reduced = useReducedMotion();
  useEffect(() => {
    const was = prev.current;
    prev.current = activeId;
    if (!activeId || !was || was === activeId) return;
    const timer = setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-question-for="${CSS.escape(activeId)}"]`);
      el?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' });
    }, 260);
    return () => clearTimeout(timer);
  }, [activeId, reduced]);
}
