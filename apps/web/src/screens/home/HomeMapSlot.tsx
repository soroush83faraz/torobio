import { HomeMapHero } from './HomeMapHero';

/**
 * Home's living map of the bazaar belt: the top band of the night hero. The SVG constellation (HomeMapHero) bleeds to
 * the hero's edges and fades into the night surface at its foot, so the heading below reads as written on the map.
 * Keeps the `data-slot="home-map"` wrapper.
 */
export function HomeMapSlot({ className = '' }: { className?: string }) {
  return (
    <div data-slot="home-map" className={`hb-home-map relative ${className}`}>
      <HomeMapHero tone="dark" aspect="3 / 2" captionAt="top" />
    </div>
  );
}
