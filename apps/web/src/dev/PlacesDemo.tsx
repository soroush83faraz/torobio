/**
 * Dev-only harness at #/dev/places (the route exists only when import.meta.env.DEV). Shows PlacesView with fixture
 * data in every state, and the Home map hero on both surfaces, without the backend.
 */
import { useState } from 'react';
import { PlacesView } from '../screens/PlacesView';
import { HomeMapHero } from '../screens/home/HomeMapHero';
import { EMPTY, FULL, PARTIAL, STOPS } from './placesFixture';

const SCENES = [
  { id: 'full', label: 'همه یک‌جا' },
  { id: 'partial', label: 'بدون پوشش کامل' },
  { id: 'route', label: 'با مسیر' },
  { id: 'loading', label: 'در حال آمدن' },
  { id: 'empty', label: 'خالی' },
  { id: 'hero', label: 'هیروی خانه' },
] as const;
type Scene = (typeof SCENES)[number]['id'];

export default function PlacesDemo() {
  const [scene, setScene] = useState<Scene>(() => (new URLSearchParams(window.location.hash.split('?')[1]).get('s') as Scene) || 'full');
  const [picked, setPicked] = useState<string | null>(null);
  const places = scene === 'partial' ? PARTIAL : scene === 'empty' ? EMPTY : FULL;

  return (
    <div className="flex flex-col" style={{ height: 'calc(100dvh - 57px)' }}>
      <nav className="flex shrink-0 gap-2 overflow-x-auto border-b border-line bg-surface px-3 py-2" aria-label="حالت‌های نمایش">
        {SCENES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => {
              setScene(s.id);
              setPicked(null);
            }}
            aria-pressed={scene === s.id}
            className={`shrink-0 rounded-full px-3 py-1 text-sm font-semibold ${scene === s.id ? 'bg-ink text-white' : 'bg-sunken text-ink'}`}
          >
            {s.label}
          </button>
        ))}
      </nav>
      {picked && (
        <p role="status" className="shrink-0 bg-accent-soft px-4 py-1 text-sm text-accent-ink">
          انتخاب شد: {picked}
        </p>
      )}
      {scene === 'hero' ? (
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <div className="surface-night overflow-hidden rounded-[28px]">
            <HomeMapHero tone="dark" />
          </div>
          <div className="overflow-hidden rounded-[28px] border border-line bg-canvas">
            <HomeMapHero tone="light" aspect="16 / 10" />
          </div>
          <div className="h-[60vh]" aria-hidden="true" />
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <PlacesView
            key={scene}
            places={places}
            stops={scene === 'route' ? STOPS : undefined}
            busy={scene === 'loading'}
            onPick={(m) => setPicked(m.name)}
          />
        </div>
      )}
    </div>
  );
}
