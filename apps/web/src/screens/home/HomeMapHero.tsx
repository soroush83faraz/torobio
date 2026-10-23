/**
 * «بازار تهران، زنده» – the Home hero ornament: every mall of the bazaar belt (real centroids from the dataset, see
 * scripts/gen-mall-centroids.mjs) drawn as an SVG constellation through a radial lens, so the dense core around
 * Aladdin / Charsou opens up while the outer malls still frame it. Dots wake up from the core outwards once, the
 * biggest malls pulse, and a few routes draw themselves between them with a travelling light.
 *
 * No Leaflet, no tiles, no network: ~10 KB of JSON bundled with the component. Colours are CSS custom properties
 * (tone="dark" for deep ink surfaces, "light" for the canvas), so the design system can re-theme it.
 * Animations pause off-screen; prefers-reduced-motion shows a still, fully drawn map.
 */
import { useEffect, useMemo, useRef } from 'react';
import centroids from '../../assets/mallCentroids.json';
import { arcPath, cdf, projectFisheye, quadLength, type FisheyeOptions } from '../../components/map/geo';
import { resolveCollisions } from '../../components/map/placeModel';
import { formatCount } from '../../lib/format';
import './homeMapHero.css';

export interface HomeMapHeroProps {
  /** Surface it sits on. Default 'dark'. */
  tone?: 'dark' | 'light';
  /** CSS aspect-ratio of the box. Default '4 / 3'. The drawing covers the box at any ratio. */
  aspect?: string;
  /** Show the «بازار تهران، زنده» chip. Default true. */
  caption?: boolean;
  /** Where the chip sits. Default 'bottom'. */
  captionAt?: 'top' | 'bottom';
  className?: string;
}

const W = 400;
const H = 300;
const CORE = { lat: 35.6935, lon: 51.4158 };
const LENS: FisheyeOptions = { center: CORE, radiusDeg: 0.125, gamma: 0.42, width: W, height: H, margin: 14 };
const HOT = 12;
/** 0 = pure lens, 1 = fully density-equalised. */
const EQUALISE = 0.6;

type Row = [number, number, number];

interface Dot {
  x: number;
  y: number;
  r: number;
  hot: boolean;
  delay: number;
  alpha: number;
}

/** `topClear`: viewBox rows kept free of mall labels (a caption chip sits there). */
function buildScene(topClear = 6) {
  const rows = centroids.malls as Row[];
  const maxN = rows[0]?.[2] ?? 1;
  // 1) radial lens around the core, 2) per-axis density equalisation: crowded strips of the bazaar get room in
  // proportion to how many malls they hold; relative positions (north of, east of) are kept
  const lens = rows.map(([lat, lon]) => projectFisheye({ lat, lon }, LENS));
  const fx = cdf(lens.map((p) => p[0]));
  const fy = cdf(lens.map((p) => p[1]));
  const m = LENS.margin ?? 0;
  const dots: Dot[] = rows.map(([, , n], i) => {
    const [lx, ly] = lens[i]!;
    const x = lx + (m + fx(lx) * (W - 2 * m) - lx) * EQUALISE;
    const y = ly + (m + fy(ly) * (H - 2 * m) - ly) * EQUALISE;
    const d = Math.hypot(x - W / 2, y - H / 2);
    const k = Math.sqrt(n / maxN);
    return {
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      r: Math.round((1.1 + k * 6.6) * 10) / 10,
      hot: i < HOT,
      // wake from the core outwards
      delay: Math.round(120 + d * 5.2),
      alpha: Math.round((0.42 + 0.5 * k) * 100) / 100,
    };
  });

  // decorative radar rings
  const rings = [0.3, 0.62, 0.95].map((f) => ({ rx: f * (W / 2 - m), ry: f * (H / 2 - m), m: f }));

  // routes: hops between big malls, long enough to read as an arc
  const hot = dots.slice(0, 24);
  const pairs: [number, number][] = [
    [0, 1],
    [2, 5],
    [3, 8],
    [4, 17],
    [6, 10],
  ];
  const arcs = pairs
    .filter(([a, b]) => hot[a] && hot[b])
    .map(([a, b], i) => {
      const A: [number, number] = [hot[a]!.x, hot[a]!.y];
      const B: [number, number] = [hot[b]!.x, hot[b]!.y];
      const bend = i % 2 ? -0.32 : 0.32;
      const d = arcPath(A, B, bend);
      const mx = (A[0] + B[0]) / 2 - (B[1] - A[1]) * bend;
      const my = (A[1] + B[1]) / 2 + (B[0] - A[0]) * bend;
      return { d, len: Math.ceil(quadLength(A, [mx, my], B)), delay: i * 1.5 };
    });

  // labels for the biggest malls, greedy so they never collide
  const names = centroids.names as string[];
  const candidates = names.slice(0, 10).map((name, i) => {
    const dot = dots[i]!;
    const w = name.length * 8.6 + 6;
    return { name, x: dot.x, y: dot.y - dot.r - 7, rect: { x: dot.x - w / 2, y: dot.y - dot.r - 24, w, h: 20 } };
  });
  const keep = resolveCollisions(
    candidates.map((c) => c.rect),
    6,
  );
  const labels = candidates.filter((c, i) => keep.has(i) && c.rect.x > 8 && c.rect.x + c.rect.w < W - 8 && c.rect.y > topClear).slice(0, 4);
  return { dots, rings, arcs, labels };
}

export function HomeMapHero({ tone = 'dark', aspect = '4 / 3', caption = true, captionAt = 'bottom', className = '' }: HomeMapHeroProps) {
  // a chip at the top covers about the first 22% of the drawing's height: no label goes under it
  const scene = useMemo(() => buildScene(caption && captionAt === 'top' ? H * 0.22 : 6), [caption, captionAt]);
  const rootRef = useRef<HTMLDivElement>(null);

  // pointer + scroll parallax, eased; paused off-screen
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let visible = true;
    const io = new IntersectionObserver(([e]) => {
      visible = !!e?.isIntersecting;
      el.classList.toggle('is-paused', !visible);
    });
    io.observe(el);
    if (still) return () => io.disconnect();

    let tx = 0;
    let ty = 0;
    let x = 0;
    let y = 0;
    let raf = 0;
    const loop = () => {
      raf = 0;
      x += (tx - x) * 0.08;
      y += (ty - y) * 0.08;
      el.style.setProperty('--hx', x.toFixed(3));
      el.style.setProperty('--hy', y.toFixed(3));
      if (Math.abs(tx - x) > 0.002 || Math.abs(ty - y) > 0.002) raf = requestAnimationFrame(loop);
    };
    const kick = () => {
      if (!raf && visible) raf = requestAnimationFrame(loop);
    };
    let scrollY = 0;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const r = el.getBoundingClientRect();
      tx = Math.max(-1, Math.min(1, ((e.clientX - r.left - r.width / 2) / r.width) * 2));
      ty = Math.max(-1, Math.min(1, ((e.clientY - r.top - r.height / 2) / r.height) * 2)) + scrollY;
      kick();
    };
    const onLeave = () => {
      tx = 0;
      ty = scrollY;
      kick();
    };
    const onScroll = () => {
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      // -1 when the hero's centre is at the viewport top, +1 at the bottom
      scrollY = Math.max(-1, Math.min(1, ((r.top + r.height / 2) / vh) * 2 - 1)) * 0.8;
      ty = scrollY;
      kick();
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => {
      io.disconnect();
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const mallCount = (centroids.malls as Row[]).length;
  const label = `نقشهٔ زندهٔ بازار تهران: ${formatCount(mallCount)} پاساژ و ${formatCount(centroids.shops)} مغازه`;

  return (
    <div ref={rootRef} className={`hb-hero relative overflow-hidden ${className}`} data-tone={tone} style={{ aspectRatio: aspect }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" role="img" aria-label={label}>
        <defs>
          <radialGradient id="hb-hero-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--hero-glow)" />
            <stop offset="100%" stopColor="var(--hero-glow)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx={W / 2} cy={H / 2} rx={W * 0.42} ry={H * 0.42} fill="url(#hb-hero-glow)" />

        <g className="hb-hero__layer" style={{ ['--depth' as string]: 0.35 }}>
          {scene.rings.map((r) => (
            <ellipse key={r.m} cx={W / 2} cy={H / 2} rx={r.rx} ry={r.ry} className="hb-hero__ring" />
          ))}
        </g>

        <g className="hb-hero__layer" style={{ ['--depth' as string]: 0.7 }}>
          {scene.dots.map((d, i) =>
            d.hot ? null : (
              <circle
                key={i}
                cx={d.x}
                cy={d.y}
                r={d.r}
                className="hb-hero__dot"
                style={{ animationDelay: `${d.delay}ms`, opacity: d.alpha }}
              />
            ),
          )}
        </g>

        <g className="hb-hero__layer" style={{ ['--depth' as string]: 1 }}>
          {scene.arcs.map((a, i) => (
            <g key={i} style={{ ['--len' as string]: a.len, ['--delay' as string]: `${a.delay + 1.6}s` }}>
              <path d={a.d} className="hb-hero__arc" />
              <circle r="2.6" className="hb-hero__comet" style={{ offsetPath: `path('${a.d}')` }} />
            </g>
          ))}
          {scene.dots.slice(0, HOT).map((d, i) => (
            <g key={i}>
              <circle cx={d.x} cy={d.y} r={d.r + 1} className="hb-hero__pulse" style={{ animationDelay: `${1.2 + ((i * 0.77) % 3)}s` }} />
              <circle cx={d.x} cy={d.y} r={Math.max(2.4, d.r * 0.82)} className="hb-hero__hot" style={{ animationDelay: `${d.delay}ms` }} />
            </g>
          ))}
        </g>

        <g className="hb-hero__layer" style={{ ['--depth' as string]: 1.15 }} aria-hidden="true">
          {scene.labels.map((l, i) => (
            <text key={l.name} x={l.x} y={l.y} className="hb-hero__label" textAnchor="middle" style={{ animationDelay: `${900 + i * 140}ms` }}>
              {l.name}
            </text>
          ))}
        </g>
      </svg>

      {caption && (
        <p
          className={`hb-hero__chip absolute start-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ${captionAt === 'top' ? 'top-3' : 'bottom-3'}`}
          aria-hidden="true"
        >
          <span className="hb-hero__live" />
          بازار تهران، زنده
          <span className="hb-hero__sep" />
          <span className="hb-hero__count font-medium">{formatCount(mallCount)} پاساژ</span>
        </p>
      )}
    </div>
  );
}

export default HomeMapHero;
