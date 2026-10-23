import { AnimatePresence } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ItemResolution, Requirement } from '../api/types';
import { t } from '../copy/fa';
import { formatTomanCompact } from '../lib/format';
import { imageOf } from '../lib/images';
import { inheritedChips, isDeadEnd } from '../lib/items';
import { BidiText } from './Bdi';
import { Button, IconButton } from './Button';
import { InfoChip } from './Chip';
import { Icon, type IconName } from './Icon';
import { NoMatchPanel } from './NoMatchPanel';
import { PriceBlock } from './PriceBlock';
import { ProductThumb } from './ProductThumb';
import { StateBadge } from './StateBadge';

interface Props {
  req: Requirement;
  res: ItemResolution;
  /** True when this card's question is the one expanded right now. */
  active?: boolean;
  onChange: () => void;
  onRemove: () => void;
  onActivate: () => void;
  onDetachChip: (key: string) => void;
  /** Accept used / refurbished / copy listings for this item (sets the condition answer to «any»). */
  onIncludeCondition?: () => void;
  /** Dead end: apply one relaxation offered by the server (`noMatch.relax[].attr`). */
  onRelax?: (attr: string) => void;
  /** Dead end: pin one of the closest models. */
  onPickModel?: (productId: string) => void;
  /** Not found: the user tapped suggested category `index` (`nearbyCategoryIds[index]`). */
  onPickNearby?: (index: number) => void;
  /**
   * The expanded QuestionCard. It is rendered right AFTER the card (the assistant's bubble under the item it asks
   * about), not inside it.
   */
  children?: ReactNode;
}

/** Plays a short glow when the item goes from «needs info» to resolved. */
function useResolvedFlash(state: ItemResolution['state']) {
  const prev = useRef(state);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    const was = prev.current;
    prev.current = state;
    if (was === 'needs_info' && state !== 'needs_info') {
      setFlash(true);
      const timer = setTimeout(() => setFlash(false), 900);
      return () => clearTimeout(timer);
    }
  }, [state]);
  return flash;
}

/** One card per item: image, the request, a single state label, product, price and sellers. */
export function ItemCard({ req, res, active, onChange, onRemove, onActivate, onDetachChip, onIncludeCondition, onRelax, onPickModel, onPickNearby, children }: Props) {
  const dead = isDeadEnd(res);
  const hasProduct = res.state === 'exact' || res.state === 'suggested' || res.state === 'alternative' || res.state === 'no_price';
  const name = res.product?.name;
  const flash = useResolvedFlash(res.state);
  // The server says what its seller count counts («۳ فروشنده با قیمت» / «۲ فروشنده، بدون قیمت»); the plain count is the fallback.
  const sellerText =
    res.sellerCountLabel ?? (res.sellerCount == null ? null : res.sellerCount === 1 ? t.item.oneSeller : t.item.sellers(res.sellerCount));
  const waiting = res.state === 'needs_info' || dead;
  const thumbIcon: IconName = dead || res.state === 'not_found' ? 'x-circle' : res.state === 'needs_info' ? 'question' : hasProduct ? 'image' : 'bag';
  return (
    <>
      <article
        data-testid="item-card"
        data-state={res.state}
        data-dead-end={dead || undefined}
        data-item={req.id}
        className={`relative rounded-card border bg-surface p-4 transition-[box-shadow,border-color] duration-300 ${
          waiting ? 'border-saffron/45' : 'border-line'
        } ${active ? 'shadow-raised ring-2 ring-saffron/35' : 'shadow-card'} ${flash ? 'animate-resolved' : ''}`}
      >
        <div className="flex items-start gap-3">
          <ProductThumb src={hasProduct ? imageOf(res.product) : undefined} icon={thumbIcon} tone={waiting ? 'saffron' : 'neutral'} size={60} />
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-extrabold leading-snug [overflow-wrap:anywhere]">
              <BidiText text={req.text} />
            </h3>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {dead ? (
                <span
                  data-testid="dead-end-badge"
                  className="inline-flex items-center gap-1 rounded-chip border border-saffron/60 bg-saffron-soft px-2.5 py-0.5 text-sm font-bold leading-6 text-saffron-ink"
                >
                  <Icon name="x-circle" size={16} />
                  {t.item.notFoundBadge}
                </span>
              ) : (
                <StateBadge state={res.state} />
              )}
              {inheritedChips(req, res).map((c) => (
                <InfoChip key={c.key} onRemove={() => onDetachChip(c.key)} removeLabel={t.item.detachChip} tone="accent">
                  <BidiText text={c.label} />
                </InfoChip>
              ))}
            </div>
          </div>
          <IconButton icon="trash" label={t.list.removeItem} onClick={onRemove} className="-mt-2 -me-2 text-ink-soft hover:text-danger" />
        </div>

        {res.conflictNote && (
          <p data-testid="conflict-note" className="mt-3 flex items-start gap-2 rounded-control border border-amber bg-amber-soft px-3 py-2 text-sm text-amber-ink">
            <Icon name="alert" size={16} className="mt-1 shrink-0" />
            <span className="min-w-0 [overflow-wrap:anywhere]">
              <BidiText text={res.conflictNote} />
            </span>
          </p>
        )}

        {res.compatNote && (
          <p data-testid="compat-note" role="note" className="mt-3 flex items-start gap-2 rounded-control bg-sunken px-3 py-2 text-sm text-ink">
            <Icon name="info" size={16} className="mt-1 shrink-0" />
            <span className="min-w-0 [overflow-wrap:anywhere]">
              <BidiText text={res.compatNote} />
            </span>
          </p>
        )}

        {dead && <NoMatchPanel res={res} onRelax={onRelax} onPickModel={onPickModel} onSeeClosest={onChange} />}

        {hasProduct && name && (
          <div className="mt-3 border-t border-line/80 pt-3">
            <p data-testid="item-product" className="text-sm font-semibold leading-relaxed [overflow-wrap:anywhere]">
              <BidiText text={name} />
            </p>
            <p className="mt-0.5 text-sm text-ink-soft">
              {res.state === 'suggested' && res.eligibleCount ? `${t.item.eligible(res.eligibleCount)} · ${t.item.pickRule(res.rule ?? '')}` : null}
              {res.state === 'alternative' && res.differs && <BidiText text={res.differs} />}
              {res.state === 'no_price' && (
                <>
                  <BidiText text={res.reason ?? ''} /> {t.item.priceUnknownHint}
                </>
              )}
            </p>
            {res.state === 'alternative' && res.incompleteSpecsCount ? (
              <p className="text-sm text-ink-soft">{t.item.incompleteSpecs(res.incompleteSpecsCount)}</p>
            ) : null}
            <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3">
              <div className="flex flex-wrap items-center gap-x-3 text-sm text-ink-soft">
                {res.unitPrice != null && (
                  <PriceBlock amount={res.unitPrice} prefix={t.item.fromWord} suffix={res.unitLabel} countUp className="text-ink" />
                )}
                {sellerText && (
                  <span data-testid="seller-count" className="inline-flex items-center gap-1">
                    <Icon name="building" size={16} />
                    {sellerText}
                  </span>
                )}
              </div>
              <Button variant="ghost" onClick={onChange} data-testid="change-item" className="-me-2">
                {res.state === 'suggested' ? t.item.chooseModel : t.item.change}
                <Icon name="chevron-forward" size={16} />
              </Button>
            </div>
          </div>
        )}

        {!!res.conditionExcludedCount && res.conditionExcludedCount > 0 && (
          <div data-testid="condition-note" className="mt-3 flex flex-wrap items-center justify-between gap-x-3 rounded-control bg-sunken ps-3 text-sm">
            <span className="min-w-0 flex-1 py-2">{t.item.conditionExcluded(res.conditionExcludedCount)}</span>
            {onIncludeCondition && res.condition !== 'any' && (
              <Button variant="ghost" onClick={onIncludeCondition} data-testid="include-condition">
                {t.item.conditionShow}
              </Button>
            )}
          </div>
        )}

        {res.state === 'needs_info' && (
          <div className="mt-3">
            {res.eligibleCount && res.rangeLow && res.rangeHigh ? (
              <p className="num text-sm text-ink-soft">
                {t.item.models(res.eligibleCount)}،{' '}
                {t.item.rangeFromTo(formatTomanCompact(res.rangeLow, false), formatTomanCompact(res.rangeHigh, false) + ' تومان')}
              </p>
            ) : null}
            {!active && (
              <Button variant="secondary" className="mt-2" icon="question" onClick={onActivate}>
                {t.list.answerNow}
              </Button>
            )}
          </div>
        )}

        {res.state === 'not_found' && !dead && (
          <div className="mt-3 space-y-2">
            <p className="text-sm">
              <BidiText text={res.reason ?? ''} />
            </p>
            <p className="text-sm text-ink-soft">{t.item.dataCovers}</p>
            {res.nearbyCategories && (
              <div>
                <p className="text-sm font-semibold">
                  <BidiText text={res.nearbyLabelFa ?? t.item.notFoundNearby} />
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {res.nearbyCategories.map((c, i) =>
                    onPickNearby && res.nearbyCategoryIds?.[i] != null ? (
                      <button
                        key={c}
                        type="button"
                        data-testid="nearby-chip"
                        aria-label={t.item.nearbyPickLabel(c)}
                        onClick={() => onPickNearby(i)}
                        className="inline-flex min-h-touch items-center gap-1.5 rounded-chip border border-line-strong/60 bg-surface px-4 text-sm font-semibold text-ink transition-colors hover:border-accent hover:bg-accent-soft active:bg-accent-soft"
                      >
                        <Icon name="plus" size={16} />
                        <BidiText text={c} />
                      </button>
                    ) : (
                      <InfoChip key={c}>
                        <BidiText text={c} />
                      </InfoChip>
                    ),
                  )}
                </div>
                {onPickNearby && res.nearbyCategoryIds?.length ? <p className="mt-1 text-sm text-ink-soft">{t.item.nearbyPickHint}</p> : null}
              </div>
            )}
            <p className="text-sm text-ink-soft">{t.item.keepAsNotFound}</p>
          </div>
        )}
      </article>
      <AnimatePresence initial={false}>{res.state === 'needs_info' && active ? children : null}</AnimatePresence>
    </>
  );
}
