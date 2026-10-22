import type { ReactNode } from 'react';
import type { ItemResolution, Requirement } from '../api/types';
import { t } from '../copy/fa';
import { formatTomanCompact } from '../lib/format';
import { inheritedChips, isDeadEnd } from '../lib/items';
import { BidiText } from './Bdi';
import { Button, IconButton } from './Button';
import { InfoChip } from './Chip';
import { Icon } from './Icon';
import { NoMatchPanel } from './NoMatchPanel';
import { PriceBlock } from './PriceBlock';
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
  /** The expanded QuestionCard, rendered inside the card. */
  children?: ReactNode;
}

/** One card per item: a single state label, product, secondary line (rule + eligible count), price. */
export function ItemCard({ req, res, active, onChange, onRemove, onActivate, onDetachChip, onIncludeCondition, onRelax, onPickModel, onPickNearby, children }: Props) {
  const dead = isDeadEnd(res);
  const hasProduct = res.state === 'exact' || res.state === 'suggested' || res.state === 'alternative' || res.state === 'no_price';
  const name = res.product?.name;
  // The server says what its seller count counts («۳ فروشنده با قیمت» / «۲ فروشنده، بدون قیمت»); the plain count is the fallback.
  const sellerText =
    res.sellerCountLabel ?? (res.sellerCount == null ? null : res.sellerCount === 1 ? t.item.oneSeller : t.item.sellers(res.sellerCount));
  return (
    <article
      data-testid="item-card"
      data-state={res.state}
      data-dead-end={dead || undefined}
      data-item={req.id}
      className={`rounded-card border bg-surface p-4 shadow-card ${
        res.state === 'needs_info' || dead ? 'border-amber/60' : 'border-line'
      } ${active ? 'ring-2 ring-accent/40' : ''}`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-base [overflow-wrap:anywhere]">
            <BidiText text={req.text} />
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {dead ? (
              <span
                data-testid="dead-end-badge"
                className="inline-flex items-center gap-1.5 rounded-chip border border-amber/60 bg-amber-soft px-3 py-0.5 text-sm font-semibold text-amber-ink"
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
        <IconButton icon="trash" label={t.list.removeItem} onClick={onRemove} className="-mt-2 -me-2 text-ink-soft" />
      </div>

      {res.conflictNote && (
        <p data-testid="conflict-note" className="mt-2 flex items-start gap-2 rounded-xl border border-amber bg-amber-soft px-3 py-2 text-sm text-amber-ink">
          <Icon name="alert" size={16} className="mt-1 shrink-0" />
          <span className="min-w-0 [overflow-wrap:anywhere]">
            <BidiText text={res.conflictNote} />
          </span>
        </p>
      )}

      {dead && <NoMatchPanel res={res} onRelax={onRelax} onPickModel={onPickModel} onSeeClosest={onChange} />}

      {hasProduct && name && (
        <div className="mt-3">
          <p data-testid="item-product" className="text-sm font-semibold">
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
                <PriceBlock amount={res.unitPrice} prefix={t.item.fromWord} suffix={res.unitLabel} />
              )}
              {sellerText && <span data-testid="seller-count">{sellerText}</span>}
            </div>
            <Button variant="ghost" onClick={onChange} data-testid="change-item">
              {res.state === 'suggested' ? t.item.chooseModel : t.item.change}
            </Button>
          </div>
        </div>
      )}

      {!!res.conditionExcludedCount && res.conditionExcludedCount > 0 && (
        <div data-testid="condition-note" className="mt-2 flex flex-wrap items-center justify-between gap-x-3 rounded-xl bg-sunken ps-3 text-sm">
          <span className="min-w-0 flex-1 py-2">{t.item.conditionExcluded(res.conditionExcludedCount)}</span>
          {onIncludeCondition && res.condition !== 'any' && (
            <Button variant="ghost" onClick={onIncludeCondition} data-testid="include-condition">
              {t.item.conditionShow}
            </Button>
          )}
        </div>
      )}

      {res.state === 'needs_info' && (
        <div className="mt-2">
          {res.eligibleCount && res.rangeLow && res.rangeHigh ? (
            <p className="text-sm text-ink-soft">
              {t.item.models(res.eligibleCount)}،{' '}
              {t.item.rangeFromTo(formatTomanCompact(res.rangeLow, false), formatTomanCompact(res.rangeHigh, false) + ' تومان')}
            </p>
          ) : null}
          {active ? (
            children
          ) : (
            <Button variant="secondary" className="mt-2" onClick={onActivate}>
              {t.list.answerNow}
            </Button>
          )}
        </div>
      )}

      {res.state === 'not_found' && !dead && (
        <div className="mt-2 space-y-2">
          <p className="text-sm">
            <BidiText text={res.reason ?? ''} />
          </p>
          <p className="text-sm text-ink-soft">{t.item.dataCovers}</p>
          {res.nearbyCategories && (
            <div>
              <p className="text-sm font-semibold"><BidiText text={res.nearbyLabelFa ?? t.item.notFoundNearby} /></p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {res.nearbyCategories.map((c, i) =>
                  onPickNearby && res.nearbyCategoryIds?.[i] != null ? (
                    <button
                      key={c}
                      type="button"
                      data-testid="nearby-chip"
                      aria-label={t.item.nearbyPickLabel(c)}
                      onClick={() => onPickNearby(i)}
                      className="inline-flex min-h-touch items-center rounded-chip border border-line-strong bg-surface px-4 text-sm font-medium text-ink hover:bg-sunken active:bg-sunken"
                    >
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
  );
}
