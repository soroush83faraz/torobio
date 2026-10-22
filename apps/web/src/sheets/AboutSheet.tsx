import { useEffect, useState } from 'react';
import { api, isMockApi } from '../api/client';
import type { MetaResponse } from '../api/types';
import { BottomSheet } from '../components/BottomSheet';
import { Icon } from '../components/Icon';
import { t } from '../copy/fa';
import { formatJalaliDate } from '../lib/format';
import { useUi } from '../store/ui';

/** v3 6.10: five bullets, counts, and what the assistant does. */
export function AboutSheet() {
  const open = useUi((s) => s.aboutOpen);
  const setOpen = useUi((s) => s.setAbout);
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  useEffect(() => {
    if (open && !meta) api.meta().then(setMeta).catch(() => undefined);
  }, [open, meta]);
  const date = meta ? meta.snapshotLabel || (meta.snapshotDate ? formatJalaliDate(`${meta.snapshotDate}T12:00:00Z`) : '') : '';
  return (
    <BottomSheet open={open} onClose={() => setOpen(false)} title={t.about.title}>
      <ol className="space-y-3">
        {t.about.bullets(date, meta?.areas.join('، ') ?? '').map((b, i) => (
          <li key={i} className="flex gap-3 text-base">
            <Icon name="info" size={20} className="mt-1 text-accent" />
            <span>{b}</span>
          </li>
        ))}
      </ol>
      {meta && meta.shopCount > 0 && (
        <p className="mt-4 rounded-xl bg-sunken px-4 py-3 text-sm font-semibold">
          {t.about.counts(meta.shopsTotal, meta.shopCount, meta.productCount)}
        </p>
      )}
      <h3 className="mt-5 text-base">{t.about.assistantHeading}</h3>
      <p className="mt-1 text-sm text-ink-soft">{t.about.assistantBody}</p>
      {isMockApi() && <p className="mt-3 text-sm text-ink-soft">{t.about.mockNote}</p>}
    </BottomSheet>
  );
}
