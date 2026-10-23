import { Link } from 'react-router-dom';
import { t } from '../copy/fa';
import { recentPlans, usePlans } from '../store/plans';
import { useUi } from '../store/ui';
import { BrandMark } from './BrandMark';
import { IconButton } from './Button';
import { Icon } from './Icon';
import { formatCount } from '../lib/format';

/** Frosted header: [mark + name] ...... [plan switcher ▾] [ⓘ] */
export function AppHeader() {
  const setResume = useUi((s) => s.setResume);
  const setAbout = useUi((s) => s.setAbout);
  const count = usePlans((s) => recentPlans(s.plans, 5).length);
  return (
    <header className="glass sticky top-0 z-30 border-b border-line/70">
      <div className="page flex h-14 items-center gap-1" style={{ paddingInline: '0.5rem 0.25rem' }}>
        <Link
          to="/"
          aria-label={t.header.home}
          className="flex min-h-touch items-center gap-2 whitespace-nowrap rounded-control px-1.5 text-lg font-black text-ink transition-opacity active:opacity-80"
        >
          <BrandMark size={34} />
          {t.app.name}
        </Link>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => setResume(true)}
          aria-haspopup="dialog"
          className="inline-flex min-h-touch items-center gap-1.5 whitespace-nowrap rounded-chip px-2.5 text-sm font-bold text-ink transition-colors hover:bg-sunken active:scale-[0.97] active:bg-sunken"
        >
          {count > 0 && (
            <span aria-hidden="true" className="num inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-accent-soft px-1.5 text-sm font-bold text-accent-ink">
              {formatCount(count)}
            </span>
          )}
          {t.header.resume}
          <Icon name="chevron-down" size={18} className="text-ink-soft" />
        </button>
        <IconButton icon="info" label={t.header.about} onClick={() => setAbout(true)} className="text-ink-soft" />
      </div>
    </header>
  );
}
