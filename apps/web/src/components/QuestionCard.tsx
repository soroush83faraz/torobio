import { AnimatePresence, motion, useIsPresent } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import type { Question, QuestionOption } from '../api/types';
import { t } from '../copy/fa';
import { AssistantAvatar } from './AssistantAvatar';
import { BidiText } from './Bdi';
import { Button } from './Button';
import { Icon } from './Icon';
import { AnimatedCheck, StepDots, TypingDots, ease, pressFeedback } from './motion';

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

/**
 * The assistant asks, one question at a time, as a chat bubble under the item it is about. Answers are large
 * single-select cards; every skippable question can be ended with «کافیه». Picking an answer fills the card and
 * draws a check while the next question is fetched, then the bubble's content slides on to it.
 */
export function QuestionCard({ question, answered, pending, busy, onAnswer, onEnough, onUnsure }: Props) {
  // The count belongs to the question on screen: the stored answers move on a moment before the next question
  // arrives, so «سؤال ۲ از ۴» must not flash in between. Recorded when a question first appears.
  const counted = useRef({ id: question.id, answered, total: answered + pending });
  if (counted.current.id !== question.id) counted.current = { id: question.id, answered, total: answered + pending };
  const { answered: done, total } = counted.current;
  // An exiting bubble (the list animates it out) must not be mistaken for the live one.
  const isPresent = useIsPresent();
  return (
    <motion.div
      data-testid={isPresent ? 'question-card' : undefined}
      data-question-for={question.itemId}
      aria-busy={busy || undefined}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6, transition: { duration: 0.18 } }}
      transition={{ duration: 0.45, ease: ease.out }}
      className="relative mt-3 scroll-mt-32"
    >
      <div className="flex items-center gap-2">
        <AssistantAvatar size={40} thinking={busy} />
        <p className="text-sm font-extrabold text-ink">{t.agent.name}</p>
        <span className="flex-1" />
        <p className="num text-sm font-bold text-accent-ink">{t.question.count(done + 1, total)}</p>
        <StepDots current={done + 1} total={total} />
      </div>
      <div className="mt-2 rounded-[22px] rounded-ss-md border border-accent/15 bg-surface p-4 shadow-raised">
        <AnimatePresence mode="wait" initial={false}>
          <QuestionBody key={question.id} question={question} busy={busy} onAnswer={onAnswer} onUnsure={onUnsure} />
        </AnimatePresence>
        {question.skippable !== false && (
          <div className="mt-3 border-t border-line pt-1">
            <Button variant="ghost" onClick={onEnough} disabled={busy} data-testid="enough" className="-ms-2">
              <Icon name="spark" size={18} />
              {t.question.enough}
            </Button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function QuestionBody({
  question,
  busy,
  onAnswer,
  onUnsure,
}: {
  question: Question;
  busy?: boolean;
  onAnswer: (optionId: string) => void;
  onUnsure?: () => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const labelId = `q-${question.id}-${question.itemId}`;

  // If the same question stays (the answer did not move things on), release the pick so it can be changed.
  useEffect(() => {
    if (!picked || busy) return;
    const timer = setTimeout(() => setPicked(null), 1600);
    return () => clearTimeout(timer);
  }, [picked, busy]);

  const regular = question.options.filter((o) => o.id !== 'any' && o.id !== 'unsure');
  // two columns only when every label and hint fits half the bubble (Latin hints never wrap, so they count double)
  const twoCol =
    regular.length >= 2 &&
    regular.every((o) => o.label.length <= 14 && (o.hint ?? '').length + ((o.hint ?? '').match(/[A-Za-z]/g)?.length ?? 0) <= 18);

  return (
    <motion.div
      initial={{ opacity: 0, x: -18 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 18, filter: 'blur(3px)', transition: { duration: 0.2, delay: 0.25, ease: ease.in } }}
      transition={{ duration: 0.4, ease: ease.out }}
    >
      <h3 id={labelId} className="text-lg font-extrabold leading-relaxed">
        <BidiText text={question.prompt} />
      </h3>
      {question.why && (
        <p className="mt-1.5 flex items-start gap-1.5 text-sm text-ink-soft">
          <Icon name="info" size={16} className="mt-1 shrink-0 text-accent" />
          <span>
            <span className="font-bold text-ink">{t.agent.whyLabel}</span> <BidiText text={question.why} />
          </span>
        </p>
      )}
      <div role="radiogroup" aria-labelledby={labelId} className={`mt-4 grid gap-2 ${twoCol ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {question.options.map((o, i) => (
          <AnswerCard
            key={o.id}
            option={o}
            index={i}
            picked={picked}
            busy={busy}
            // skip/unsure take the full row; with an odd count the last regular answer does too (no hole in the grid)
            wide={twoCol && (o.id === 'any' || o.id === 'unsure' || (regular.length % 2 === 1 && o.id === regular[regular.length - 1]!.id))}
            onPick={() => {
              if (o.id === 'unsure' && onUnsure) {
                onUnsure();
                return;
              }
              setPicked(o.id);
              onAnswer(o.id);
            }}
          />
        ))}
      </div>
      <AnimatePresence>
        {picked && busy && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-center gap-2 overflow-hidden pt-3 text-sm text-ink-soft"
          >
            <TypingDots />
            {t.agent.thinking}
          </motion.p>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function AnswerCard({
  option: o,
  index,
  picked,
  busy,
  wide,
  onPick,
}: {
  option: QuestionOption;
  index: number;
  picked: string | null;
  busy?: boolean;
  wide: boolean;
  onPick: () => void;
}) {
  const skip = o.id === 'any';
  const unsure = o.id === 'unsure';
  const chosen = picked === o.id;
  const dimmed = !!picked && !chosen;
  const disabled = busy || !!picked;
  const tone = chosen
    ? 'border-accent bg-accent text-white shadow-[0_8px_18px_-10px_rgba(183,24,34,0.8)]'
    : skip || unsure
      ? 'border-dashed border-line-strong/60 bg-transparent text-ink-soft hover:border-accent/60 hover:bg-accent-soft/40'
      : 'border-line bg-canvas text-ink hover:border-accent/70 hover:bg-accent-soft/50';
  return (
    <motion.button
      type="button"
      role="radio"
      aria-checked={chosen}
      disabled={disabled}
      onClick={onPick}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: dimmed ? 0.45 : 1, y: 0, scale: chosen ? 1.02 : 1 }}
      whileTap={disabled ? undefined : pressFeedback.whileTap}
      transition={{ duration: 0.3, ease: ease.out, delay: picked ? 0 : 0.05 + index * 0.04 }}
      className={`flex min-h-[56px] items-center gap-2 rounded-[16px] border px-4 py-2.5 text-start transition-colors duration-200 disabled:cursor-default ${tone} ${
        wide ? 'col-span-2' : ''
      }`}
    >
      {unsure && !chosen && <Icon name="question" size={18} className="shrink-0" />}
      <span className="min-w-0 flex-1 overflow-hidden">
        <span className={`block text-base leading-snug ${skip || unsure ? 'font-semibold' : 'font-bold'}`}>
          <BidiText text={o.label} />
        </span>
        {o.hint && (
          <span className={`mt-0.5 block text-sm leading-snug ${chosen ? 'text-white/85' : 'text-ink-soft'}`}>
            <BidiText text={o.hint} />
          </span>
        )}
      </span>
      {chosen && (
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/20">
          <AnimatedCheck size={18} />
        </span>
      )}
    </motion.button>
  );
}
