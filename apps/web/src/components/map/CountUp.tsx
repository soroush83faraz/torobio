import { useEffect, useRef, useState } from 'react';
import { easeOutExpo } from './placeModel';

/** Counts from the previous value (0 on mount) to `value`; instant under prefers-reduced-motion. */
export function useCountUp(value: number, duration = 900): number {
  const [shown, setShown] = useState(() => (prefersStill() ? value : 0));
  const from = useRef(shown);
  useEffect(() => {
    if (prefersStill()) {
      setShown(value);
      from.current = value;
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const v = a + (value - a) * easeOutExpo(t);
      setShown(v);
      from.current = v;
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return shown;
}

function prefersStill(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export function CountUp({ value, format, duration }: { value: number; format: (n: number) => string; duration?: number }) {
  const n = useCountUp(value, duration);
  return (
    <>
      <span aria-hidden="true">{format(Math.round(n))}</span>
      <span className="sr-only-fa">{format(value)}</span>
    </>
  );
}
