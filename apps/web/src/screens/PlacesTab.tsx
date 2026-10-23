/**
 * «نقشه» tab: PlacesView filling the space under the sticky header and the tab bar (the page itself does not
 * scroll; the sheet does), with the assistant's progress while the malls are compared, an error state with retry,
 * and the list's teaser card.
 */
import { AnimatePresence, motion } from 'motion/react';
import { useLayoutEffect, useRef, useState } from 'react';
import type { PlaceMall, PlacesResponse, Stop } from '../api/types';
import { AssistantAvatar } from '../components/AssistantAvatar';
import { BidiText } from '../components/Bdi';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { TypingDots, ease, pressFeedbackSoft } from '../components/motion';
import { t } from '../copy/fa';
import { formatTomanCompact } from '../lib/format';
import { buildingName, teaserLine } from '../lib/places';
import { PlacesView } from './PlacesView';
import type { PlacesData } from './usePlaces';

const EMPTY: PlacesResponse = { malls: [], bestId: null };

/** Height from this element's top to the bottom of the viewport, kept current on resize. */
function useFillHeight() {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState<number | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current;
      if (el) setTop(Math.round(el.getBoundingClientRect().top + window.scrollY));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  return { ref, height: top === null ? '70dvh' : `calc(100dvh - ${top}px)` };
}

export function PlacesTab({ data, stops, onPick }: { data: PlacesData; stops?: Stop[]; onPick: (m: PlaceMall) => void }) {
  const { ref, height } = useFillHeight();
  const { places, loading, elapsed, error, retry } = data;
  const first = !places;

  return (
    <div ref={ref} className="relative isolate -mx-4 overflow-hidden" style={{ height }} data-testid="places-view" aria-busy={loading || undefined}>
      {first && error ? (
        <div className="grid h-full place-items-center bg-sunken px-6" role="alert" data-testid="places-error">
          <div className="flex max-w-[30ch] flex-col items-center text-center">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-danger-soft text-danger" aria-hidden="true">
              <Icon name="pin" size={26} />
            </span>
            <h2 className="mt-3 text-lg font-extrabold">{t.places.errorTitle}</h2>
            <p className="mt-1 text-sm text-ink-soft">{error || t.places.errorBody}</p>
            <Button variant="primary" icon="refresh" className="mt-4" onClick={retry} data-testid="places-retry">
              {t.error.retry}
            </Button>
          </div>
        </div>
      ) : (
        <PlacesView places={places ?? EMPTY} stops={stops} busy={first} onPick={onPick} className="!min-h-0" />
      )}

      {/* the assistant says what it is doing while the first answer is computed */}
      <AnimatePresence>
        {first && loading && (
          <motion.div
            key="progress"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8, transition: { duration: 0.18 } }}
            transition={{ duration: 0.4, ease: ease.out }}
            className="pointer-events-none absolute inset-x-3 top-3 z-[700] flex items-start gap-2.5"
            role="status"
            data-testid="places-progress"
          >
            <AssistantAvatar size={40} thinking />
            <div className="min-w-0 flex-1 rounded-[22px] rounded-ss-md bg-surface/95 px-4 py-2.5 shadow-raised ring-1 ring-black/5 backdrop-blur">
              <p className="flex items-center gap-2 text-sm font-extrabold text-ink">
                {t.agent.name}
                <TypingDots />
              </p>
              <AnimatePresence mode="wait" initial={false}>
                <motion.p
                  key={progressIndex(elapsed)}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6, transition: { duration: 0.15 } }}
                  transition={{ duration: 0.35, ease: ease.out }}
                  className="text-base font-semibold leading-relaxed text-ink"
                >
                  {progressText(elapsed)}
                </motion.p>
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* a recompute with an older answer on screen: a quiet pill, the map stays usable */}
      {!first && (loading || error) && (
        <div className="absolute inset-x-0 top-3 z-[700] flex justify-center">
          {error ? (
            <button
              type="button"
              onClick={retry}
              className="inline-flex min-h-touch items-center gap-2 rounded-full bg-surface px-4 text-sm font-bold text-danger shadow-raised"
            >
              <Icon name="refresh" size={16} />
              {t.places.staleError}؛ {t.error.retry}
            </button>
          ) : (
            <span role="status" className="inline-flex items-center gap-2 rounded-full bg-surface/95 px-4 py-2 text-sm font-semibold text-ink-soft shadow-raised">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent border-t-transparent" aria-hidden="true" />
              {t.places.updating}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

const progressIndex = (s: number) => (s < 3 ? 0 : s < 6 ? 1 : s < 9 ? 2 : 3);
function progressText(s: number): string {
  const i = progressIndex(s);
  const lines: readonly string[] = t.places.progress;
  return lines[i] ?? t.places.progressSlow;
}

/* ------------------------------------------------------------------ */

/**
 * The list's teaser: once nothing is left to answer and the server named a best mall, «همهٔ ۴ مورد یک‌جا پیدا
 * می‌شود: پاساژ …» with a way to the map. A dusk card: one of the screen's few dark surfaces, so it reads as news.
 */
export function PlacesTeaser({ mall, onOpen }: { mall: PlaceMall; onOpen: () => void }) {
  const full = mall.covered >= mall.total;
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      {...pressFeedbackSoft}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: ease.out, delay: 0.15 }}
      data-testid="places-teaser"
      className="surface-night group relative mt-4 flex w-full items-center gap-3 overflow-hidden rounded-card p-4 text-start shadow-hero"
    >
      <span className="girih" aria-hidden="true" />
      <span className="relative grid h-12 w-12 shrink-0 place-items-center rounded-full bg-saffron text-ink shadow-[0_6px_16px_-6px_rgba(232,163,23,0.8)]" aria-hidden="true">
        <Icon name={full ? 'check' : 'pin'} size={24} />
      </span>
      <span className="relative min-w-0 flex-1">
        <span className="block text-base font-extrabold leading-snug text-night-ink">
          {teaserLine(mall)}: <BidiText text={buildingName(mall.name)} />
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-night-soft">
          {mall.totalToman != null && <span className="num">{formatTomanCompact(mall.totalToman)}</span>}
          <span className="inline-flex items-center gap-1 font-bold text-saffron-bright">
            {t.places.teaserCta}
            <Icon name="arrow-forward" size={16} className="transition-transform duration-200 group-hover:-translate-x-1" />
          </span>
        </span>
      </span>
    </motion.button>
  );
}
