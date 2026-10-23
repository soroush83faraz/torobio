import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { isAborted } from '../api/http';
import type { PlacesResponse, RequirementState } from '../api/types';
import { placesKey, placesStateOf } from '../lib/places';

export interface PlacesData {
  places: PlacesResponse | null;
  /** A call is in flight (with or without an older answer on screen). */
  loading: boolean;
  /** Seconds the current call has been running (drives the assistant's progress lines). */
  elapsed: number;
  error: string | null;
  retry: () => void;
}

/** Wait this long after the last state change before asking (answers often come in quick succession). */
const DEBOUNCE_MS = 350;
const CACHE_MAX = 12;
/** Answers by request key, newest last; shared across plans and remounts for the session. */
const cache = new Map<string, PlacesResponse>();

function remember(key: string, value: PlacesResponse) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
}

/**
 * «کجا برم؟» for the current requirement state: POST /api/places once the plan is ready (`enabled`) and again whenever
 * the state changes, debounced; a newer call aborts the older one (the HTTP adapter's `places` key) and stale answers
 * are ignored. Answers are cached by the state's hash, so going back to an earlier state (undo) is instant. The
 * previous answer stays on screen while a new one is computed.
 */
export function usePlaces(state: RequirementState | null, enabled: boolean): PlacesData {
  const key = state && enabled ? placesKey(state) : '';
  const [shown, setShown] = useState<{ key: string; value: PlacesResponse } | null>(() => (key && cache.has(key) ? { key, value: cache.get(key)! } : null));
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const run = useRef(0);

  useEffect(() => {
    if (!key) return;
    const hit = cache.get(key);
    if (hit) {
      run.current += 1;
      setShown({ key, value: hit });
      setLoading(false);
      setError(null);
      return;
    }
    const mine = ++run.current;
    setLoading(true);
    setError(null);
    setElapsed(0);
    const started = Date.now();
    const tick = window.setInterval(() => mine === run.current && setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const value = await api.places(placesStateOf(JSON.parse(key) as RequirementState));
          if (mine !== run.current) return;
          remember(key, value);
          setShown({ key, value });
          setLoading(false);
        } catch (e) {
          if (isAborted(e) || mine !== run.current) return;
          setError((e as { messageFa?: string }).messageFa || 'پاساژها پیدا نشدند؛ دوباره امتحان کن.');
          setLoading(false);
        } finally {
          window.clearInterval(tick);
        }
      })();
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(tick);
    };
  }, [key, nonce]);

  // leaving the screen invalidates anything still in flight
  useEffect(
    () => () => {
      run.current += 1;
    },
    [],
  );

  const retry = useCallback(() => setNonce((n) => n + 1), []);
  return { places: shown?.value ?? null, loading, elapsed, error, retry };
}

/** For tests. */
export function clearPlacesCache() {
  cache.clear();
}
