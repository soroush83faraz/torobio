import type { ItemResolution, ModelOption } from '../api/types';
import { t } from '../copy/fa';
import { formatTomanCompact } from '../lib/format';
import { BidiText } from './Bdi';
import { Button } from './Button';
import { FlagNote } from './FlagNote';
import { Icon } from './Icon';

interface Props {
  res: ItemResolution;
  /** Applies one relaxation (attr from the server's `relax`). */
  onRelax?: (attr: string) => void;
  /** Pins one of the closest models. */
  onPickModel?: (productId: string) => void;
  /** Opens the options sheet («ببین گزینه‌های نزدیک»). */
  onSeeClosest: () => void;
}

const MAX_CLOSEST = 3;

/**
 * The dead end: nothing matched what the user stated. Never a bare badge.
 *  - With the server's `noMatch`: the reason, one primary button per relaxation, up to 3 closest models to pin.
 *  - Without it (older server / mock; state «جایگزین» and no product): a calm «این مورد دقیقاً پیدا نشد» with the
 *    server's own sentence and the button that opens the options sheet.
 */
export function NoMatchPanel({ res, onRelax, onPickModel, onSeeClosest }: Props) {
  const nm = res.noMatch;
  const reason = nm?.reasonFa || res.differs || res.detail || t.item.deadEndHint;
  const closest = (nm?.closest ?? []).slice(0, MAX_CLOSEST);
  return (
    <div data-testid="no-match" data-source={nm ? 'server' : 'derived'} className="mt-3 rounded-2xl border border-amber/60 bg-amber-soft p-3 text-amber-ink">
      <p className="flex items-start gap-2 text-base font-bold">
        <Icon name="alert" size={18} className="mt-1 shrink-0" />
        <span>{nm ? t.item.noMatchTitle : t.item.deadEndTitle}</span>
      </p>
      <p data-testid="no-match-reason" className="mt-1 text-sm text-ink [overflow-wrap:anywhere]">
        <BidiText text={reason} />
      </p>

      {nm && nm.relax.length > 0 && (
        <div className="mt-3 text-ink">
          <p className="text-sm font-semibold">{t.item.relaxHeading}</p>
          <div className="mt-1.5 flex flex-col gap-2">
            {nm.relax.map((r) => (
              <Button key={r.attr} variant="primary" block onClick={() => onRelax?.(r.attr)} data-testid="relax" data-attr={r.attr}>
                <BidiText text={r.label} />
              </Button>
            ))}
          </div>
        </div>
      )}

      {closest.length > 0 && (
        <div className="mt-3 text-ink">
          <p className="text-sm font-semibold">{t.item.closestHeading}</p>
          <ul className="mt-1.5 space-y-2">
            {closest.map((m) => (
              <ClosestRow key={m.productId} m={m} onPick={() => onPickModel?.(m.productId)} />
            ))}
          </ul>
        </div>
      )}

      {(!nm || closest.length === 0) && (
        <Button variant={nm && nm.relax.length > 0 ? 'secondary' : 'primary'} block className="mt-3" onClick={onSeeClosest} data-testid="see-closest">
          {t.item.seeClosest}
        </Button>
      )}
    </div>
  );
}

function ClosestRow({ m, onPick }: { m: ModelOption; onPick: () => void }) {
  const price = m.priceLow ? `${formatTomanCompact(m.priceLow)}${m.priceHigh > m.priceLow ? ` تا ${formatTomanCompact(m.priceHigh)}` : ''}` : t.options.noPrice;
  return (
    <li data-testid="closest-model" className="rounded-xl border border-line bg-surface p-3">
      <p className="text-sm font-bold [overflow-wrap:anywhere]">
        <BidiText text={m.name} />
      </p>
      <p className="mt-0.5 text-sm text-ink-soft">{price}</p>
      {m.diffLabel && (
        <p className="text-sm font-semibold [overflow-wrap:anywhere]">
          <BidiText text={m.diffLabel} />
        </p>
      )}
      <FlagNote flags={m.flags} flagLabels={m.flagLabels} className="mt-1" />
      {m.conflict ? (
        // a listing-stated conflict is explained, never offered as a pick (same rule as the options sheet)
        <p className="mt-1 text-sm font-semibold text-amber-ink">
          <BidiText text={m.conflict} />
        </p>
      ) : (
        <Button variant="secondary" block className="mt-2" onClick={onPick} data-testid="pick-closest">
          {t.item.pickThisModel}
        </Button>
      )}
    </li>
  );
}
