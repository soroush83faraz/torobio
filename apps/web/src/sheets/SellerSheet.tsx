import { useEffect, useState } from 'react';
import type { Stop, StopLine, StopShop } from '../api/types';
import { BidiText } from '../components/Bdi';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { FlagNote } from '../components/FlagNote';
import { Icon } from '../components/Icon';
import { PriceInput } from '../components/PriceInput';
import { ReportBadge } from '../components/ReportBadge';
import { t } from '../copy/fa';
import { formatCount, formatJalaliDate, formatToman } from '../lib/format';
import type { Report, ReportKind } from '../store/plans';

interface Props {
  open: boolean;
  line: StopLine | null;
  stop: Stop | null;
  shop: StopShop | null;
  report?: Report;
  onClose: () => void;
  onReport: (kind: ReportKind, price?: number) => void;
  onRemoveReport: () => void;
}

/** v3 6.6: large, readable, meant to be shown or read aloud. Carries «از فروشنده بپرس». */
export function SellerSheet({ open, line, stop, shop, report, onClose, onReport, onRemoveReport }: Props) {
  const [priceMode, setPriceMode] = useState(false);
  useEffect(() => {
    if (open) setPriceMode(false);
  }, [open]);
  if (!line || !stop || !shop) return <BottomSheet open={false} onClose={onClose} title={t.seller.sheetTitle}>{null}</BottomSheet>;

  const done = (kind: ReportKind, price?: number) => {
    onReport(kind, price);
    onClose();
  };

  return (
    <BottomSheet open={open} onClose={onClose} title={t.seller.sheetTitle}>
      <div data-testid="seller-card" className="space-y-4">
        <div className="rounded-2xl border border-line bg-surface p-4">
          <p data-testid="seller-product" className="text-xl font-extrabold leading-snug">
            <BidiText text={line.productName} />
          </p>
          {(line.flagLabels?.length || line.flags?.length) ? (
            <p className="mt-2">
              <FlagNote flags={line.flags} flagLabels={line.flagLabels} className="!text-base" />
            </p>
          ) : null}
          <dl className="mt-3 space-y-2 text-lg">
            <div className="flex flex-wrap justify-between gap-x-3">
              <dt className="text-ink-soft">{t.seller.qty}</dt>
              <dd className="font-bold">{formatCount(line.qty)}</dd>
            </div>
            {line.unitPrice != null && (
              <div className="flex flex-wrap justify-between gap-x-3">
                <dt className="text-ink-soft">{t.seller.price}</dt>
                <dd className="font-bold">
                  {formatToman(line.unitPrice)}
                  {line.unitLabel ? (
                    <span className="block text-sm font-normal text-ink-soft">
                      <BidiText text={line.unitLabel} />
                    </span>
                  ) : null}
                </dd>
              </div>
            )}
            <div className="flex flex-wrap justify-between gap-x-3 text-base">
              <dt className="text-ink-soft">{t.seller.priceChanged}</dt>
              <dd className="whitespace-nowrap">{formatJalaliDate(line.priceChangedAt)}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-x-3 text-base">
              <dt className="text-ink-soft">{t.seller.shop}</dt>
              <dd className="text-end" data-testid="seller-shop">
                <BidiText text={shop.shopName} />
                <span className="block text-sm text-ink-soft">
                  <BidiText text={[stop.mall, shop.floor, shop.unit].filter(Boolean).join('، ')} />
                </span>
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-sm text-ink-soft">
            <span className="font-semibold">{t.plan.listingTitle}: </span>
            «<BidiText text={line.listingTitle} />»
          </p>
        </div>

        {line.askSeller.length > 0 && (
          <section aria-labelledby="ask-h" className="rounded-2xl bg-amber-soft px-4 py-3">
            <h3 id="ask-h" className="flex items-center gap-1.5 text-base text-amber-ink">
              <Icon name="question" size={18} />
              {t.seller.askHeading}
            </h3>
            <ul className="mt-1 list-disc ps-5 text-base">
              {line.askSeller.map((q) => (
                <li key={q}>
                  <BidiText text={q} />
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="rounded-xl bg-sunken px-4 py-3 text-base">{t.seller.disclaimer}</p>

        {report && <ReportBadge report={report} onRemove={onRemoveReport} />}

        {priceMode ? (
          <PriceInput id="differs-price" onSave={(p) => done('price', p)} />
        ) : (
          <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-3">
            <Button variant="secondary" size="lg" onClick={() => done('available')} data-testid="report-available">
              {t.seller.available}
            </Button>
            <Button variant="secondary" size="lg" onClick={() => done('unavailable')} data-testid="report-unavailable">
              {t.seller.unavailable}
            </Button>
            <Button variant="secondary" size="lg" onClick={() => setPriceMode(true)} data-testid="report-price">
              {t.seller.priceDiffers}
            </Button>
          </div>
        )}
        <p className="text-center text-sm text-ink-soft">{t.report.deviceOnly}</p>
      </div>
    </BottomSheet>
  );
}
