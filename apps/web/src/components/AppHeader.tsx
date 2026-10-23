import { Link } from 'react-router-dom';
import { t } from '../copy/fa';
import { formatCount } from '../lib/format';
import { usePlans } from '../store/plans';
import { useUi } from '../store/ui';
import { IconButton } from './Button';
import { Icon } from './Icon';

/** Header without a tab bar: [name] ...... [ادامه‌ی برنامه ▾] [ⓘ] */
export function AppHeader() {
  const setResume = useUi((s) => s.setResume);
  const setAbout = useUi((s) => s.setAbout);
  const planCount = usePlans((s) => Object.keys(s.plans).length);
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/95 backdrop-blur">
      <div className="page flex h-14 items-center gap-1" style={{ paddingInline: '0.5rem 0.25rem' }}>
        <Link
          to="/"
          aria-label={t.header.home}
          className="flex min-h-touch items-center gap-2 rounded-xl px-2 text-lg font-extrabold text-accent-ink"
        >
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white">
            <Icon name="bag" size={18} />
          </span>
          {t.app.name}
        </Link>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => setResume(true)}
          aria-haspopup="dialog"
          className="inline-flex min-h-touch items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-ink hover:bg-sunken"
        >
          {t.header.resume}
          {planCount > 0 && (
            <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-accent-soft px-1.5 text-sm font-bold leading-6 text-accent-ink">
              {formatCount(planCount)}
            </span>
          )}
          <Icon name="chevron-down" size={18} />
        </button>
        <IconButton icon="info" label={t.header.about} onClick={() => setAbout(true)} />
      </div>
    </header>
  );
}
