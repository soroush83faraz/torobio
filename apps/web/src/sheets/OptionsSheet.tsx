import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { ModelOption, OptionsResponse, RequirementState, SellerOption } from '../api/types';
import { BidiText } from '../components/Bdi';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { CompatChip } from '../components/CompatChip';
import { FlagNote } from '../components/FlagNote';
import { InfoChip } from '../components/Chip';
import { PriceBlock } from '../components/PriceBlock';
import { SegmentedControl } from '../components/SegmentedControl';
import { SkeletonCards } from '../components/Skeleton';
import { ErrorState } from '../components/States';
import { t } from '../copy/fa';
import { formatTomanCompact } from '../lib/format';

type Tab = 'models' | 'sellers';

/** Long real lists are paged: this many rows at first, then «نمایش … مورد دیگر». */
const PAGE = 8;

interface Props {
  open: boolean;
  state: RequirementState;
  itemId: string | null;
  itemName: string;
  /** 'unavailable' opens on the sellers tab with the replan intro (user reported «موجود نیست»). */
  mode?: 'change' | 'unavailable';
  /** In «unavailable» mode: the shop the user reported. */
  reportedShopId?: string;
  visitActive: boolean;
  onClose: () => void;
  onPickModel: (productId: string) => void;
  onPickShop: (shopId: string) => void;
}

/** v3 6.5: «مدل‌های مشابه» and «فروشنده‌ها». Also the follow-up after a «موجود نیست» report. */
export function OptionsSheet({ open, state, itemId, itemName, mode = 'change', reportedShopId, visitActive, onClose, onPickModel, onPickShop }: Props) {
  const [tab, setTab] = useState<Tab>('models');
  const [data, setData] = useState<OptionsResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    if (!open || !itemId) return;
    setTab(mode === 'unavailable' ? 'sellers' : 'models');
    setData(null);
    setFailed(false);
    setShown(PAGE);
    let cancelled = false;
    api
      .options({ state, itemId })
      .then((r) => !cancelled && setData(r))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
    // state is intentionally read once per open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, itemId, mode, nonce]);

  return (
    <BottomSheet open={open} onClose={onClose} title={mode === 'unavailable' ? t.market.replanTitle : t.options.title}>
      <p className="mb-3 text-sm text-ink-soft">{mode === 'unavailable' ? t.market.replanIntro : <BidiText text={itemName} />}</p>
      <SegmentedControl<Tab>
        label={t.options.title}
        value={tab}
        onChange={setTab}
        options={[
          { value: 'models', label: t.options.tabModels },
          { value: 'sellers', label: t.options.tabSellers },
        ]}
      />
      <div className="mt-4 space-y-3" data-testid="options-list">
        {failed ? (
          <ErrorState body={t.options.loadError} onRetry={() => setNonce((n) => n + 1)} />
        ) : !data ? (
          <SkeletonCards count={3} />
        ) : tab === 'models' ? (
          <>
            {data.poolLabel && (
              <p className="text-sm font-semibold" data-testid="pool-label">
                <BidiText text={data.poolLabel} />
              </p>
            )}
            {(data.eligibleCount ?? data.modelTotal ?? data.models.length) > data.models.length && (
              <p className="text-sm text-ink-soft">{t.options.capNote(data.models.length)}</p>
            )}
            {data.models.slice(0, shown).map((m) => (
              <ModelRow key={m.productId} m={m} onPick={() => onPickModel(m.productId)} />
            ))}
            <More shown={shown} total={data.models.length} onMore={() => setShown((n) => n + PAGE)} />
          </>
        ) : (
          <>
            {data.sellers.length === 0 && <p className="rounded-xl bg-sunken px-4 py-3 text-sm">{t.options.noSellersYet}</p>}
            {data.onlyOneSeller && <p className="rounded-xl bg-sunken px-4 py-2 text-sm">{t.options.onlyOne}</p>}
            {data.sellers.slice(0, shown).map((s) => (
              <SellerRow
                key={s.shopId}
                s={s}
                reported={mode === 'unavailable' && s.shopId === reportedShopId}
                visitActive={visitActive}
                pinned={!!itemId && s.productId !== undefined && state.pins?.[itemId] === s.productId}
                onPick={() => onPickShop(s.shopId)}
              />
            ))}
            <More shown={shown} total={data.sellers.length} onMore={() => setShown((n) => n + PAGE)} />
          </>
        )}
      </div>
    </BottomSheet>
  );
}

function More({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  if (total <= shown) return null;
  return (
    <Button variant="secondary" block onClick={onMore} data-testid="show-more">
      {t.options.showMore(Math.min(PAGE, total - shown))}
    </Button>
  );
}

export function ModelRow({ m, onPick }: { m: ModelOption; onPick: () => void }) {
  return (
    <article className={`rounded-card border bg-surface p-4 ${m.conflict ? 'border-amber/60' : 'border-line'}`} data-conflict={m.conflict ? 'true' : undefined}>
      <p className="text-base font-bold [overflow-wrap:anywhere]">
        <BidiText text={m.name} />
      </p>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {m.specs.map((s) => (
          <InfoChip key={s}>
            <BidiText text={s} />
          </InfoChip>
        ))}
        <FlagNote flags={m.flags} flagLabels={m.flagLabels} />
        {m.current && <InfoChip tone="accent">{t.options.current}</InfoChip>}
        {!m.current && m.fit === 'incomplete' && <InfoChip tone="amber">{t.options.fitIncomplete}</InfoChip>}
        {!m.current && m.fit === 'differs' && !m.conflict && <InfoChip tone="amber">{t.options.fitDiffers}</InfoChip>}
      </div>
      <p className="mt-2 text-sm text-ink-soft">
        {m.priceLow ? `${formatTomanCompact(m.priceLow)}${m.priceHigh > m.priceLow ? ` تا ${formatTomanCompact(m.priceHigh)}` : ''}` : t.options.noPrice}
        {' · '}
        {m.sellerCountLabel ?? (m.sellerCount === 1 ? t.item.oneSeller : t.item.sellers(m.sellerCount))}
      </p>
      {m.diffLabel && (
        <p className="text-sm font-semibold">
          <BidiText text={m.diffLabel} />
        </p>
      )}
      {m.conflict ? (
        <div className="mt-2 space-y-1">
          <CompatChip level="conflict" />
          <p className="text-sm">
            <BidiText text={m.conflict} />
          </p>
        </div>
      ) : (
        <Button variant={m.current ? 'secondary' : 'primary'} className="mt-3" block onClick={onPick} disabled={m.current}>
          {m.current ? t.options.alreadyCurrent : t.options.use}
        </Button>
      )}
    </article>
  );
}

/**
 * One seller of the model. A seller whose own listing title states a condition the item does not accept
 * (`conditionExcluded`: «کپی» / «کارکرده» / «ریفربیش») is greyed out with the reason and can only be chosen when the user
 * pinned this very model (`pinned`): the server plans such a shop only for a pinned product AND a pinned shop.
 */
export function SellerRow({ s, reported, visitActive, pinned = false, onPick }: { s: SellerOption; reported: boolean; visitActive: boolean; pinned?: boolean; onPick: () => void }) {
  const blocked = !!s.conditionExcluded && !pinned;
  return (
    <article
      data-testid="seller-row"
      data-condition-excluded={s.conditionExcluded ? 'true' : undefined}
      data-blocked={blocked || undefined}
      className={`rounded-card border bg-surface p-4 ${s.conditionExcluded ? 'border-dashed border-line-strong' : 'border-line'} ${blocked ? 'opacity-70' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-base font-bold">
            <BidiText text={s.shopName} />
          </p>
          <p className="text-sm text-ink-soft">
            <BidiText text={[s.mall, s.floor, s.unit].filter(Boolean).join(' · ')} />
          </p>
        </div>
        {s.current && !reported && <InfoChip tone="accent">{t.options.current}</InfoChip>}
        {reported && <InfoChip tone="amber">{t.options.reportedHere}</InfoChip>}
      </div>
      <p className="mt-2 text-sm text-ink-soft">
        «<BidiText text={s.listingTitle} />»
      </p>
      {((s.flagLabels?.length ?? 0) > 0 || (s.flags?.length ?? 0) > 0 || s.flagReason) && (
        <div data-testid="seller-flags" className="mt-1 space-y-0.5">
          <FlagNote flags={s.flags} flagLabels={s.flagLabels} />
          {s.flagReason && (
            <p data-testid="flag-reason" className="text-sm text-ink-soft [overflow-wrap:anywhere]">
              <BidiText text={s.flagReason} />
            </p>
          )}
        </div>
      )}
      {s.conditionExcluded && (
        <p data-testid="condition-excluded-note" className="mt-1 text-sm font-semibold text-amber-ink">
          {pinned ? t.options.excludedPinned : t.options.excludedSeller}
        </p>
      )}
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3">
        {s.price != null ? <PriceBlock amount={s.price} /> : <span className="text-sm font-semibold">{t.options.noPrice}</span>}
        <span className="text-sm text-ink-soft">
          <BidiText text={s.warranty} />
        </span>
      </div>
      <p className="text-sm text-ink-soft">
        <BidiText text={s.hoursText} />
        {visitActive && s.open !== 'unknown' && ` · ${s.open === 'open' ? t.options.open : t.options.closed}`}
      </p>
      {s.distanceNote && (
        <p className="text-sm text-ink-soft">
          <BidiText text={s.distanceNote} />
        </p>
      )}
      <Button variant={s.current ? 'secondary' : 'primary'} className="mt-3" block onClick={onPick} disabled={s.current || reported || s.price == null || blocked}>
        {reported ? t.options.reportedHere : s.current ? t.options.alreadyCurrent : blocked ? t.options.excludedButton : t.options.useSeller}
      </Button>
    </article>
  );
}
