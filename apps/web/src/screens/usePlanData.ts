import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { isAborted } from '../api/http';
import type { PlanResponse, ResolveResponse } from '../api/types';
import { requirementStateOf, type SavedPlan } from '../store/plans';

export interface PlanData {
  resolve: ResolveResponse | null;
  plan: PlanResponse | null;
  /** First load (no data yet). */
  loading: boolean;
  /** A recompute is in flight while old data is still shown. */
  refreshing: boolean;
  error: boolean;
  /** Persian message of the last failure. */
  errorMessage: string | null;
  /** The call has been running for more than 3 s: show a calm "server is slow" line. */
  slow: boolean;
  reload: () => void;
}

/** Recompute calls that arrive within this window collapse into one (fast successive answers). */
const DEBOUNCE_MS = 90;
/** After this long a calm "slow server" message is shown. */
const SLOW_MS = 3000;

/**
 * Computed output is never persisted: plan (+ the per-item resolutions) is recomputed from the
 * requirement state whenever it changes, so it always matches the data version. A newer call supersedes
 * the older one (the HTTP adapter aborts it); stale responses are ignored. Old data stays on screen
 * while a refresh runs (optimistic UI), and a failed refresh keeps showing the last good data.
 */
export function usePlanData(saved: SavedPlan | undefined): PlanData {
  const [data, setData] = useState<{ resolve: ResolveResponse; plan: PlanResponse } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const [nonce, setNonce] = useState(0);
  const run = useRef(0);
  const have = useRef(false);
  have.current = !!data;

  const key = saved ? JSON.stringify(requirementStateOf(saved)) : '';
  const savedId = saved?.id;

  useEffect(() => {
    if (!key) return;
    const state = JSON.parse(key) as ReturnType<typeof requirementStateOf>;
    const mine = ++run.current;
    setRefreshing(true);
    setError(null);
    const slowTimer = setTimeout(() => mine === run.current && setSlow(true), SLOW_MS);
    const timer = setTimeout(
      () => {
        void (async () => {
          try {
            const plan = await api.plan({ state });
            // The plan response carries the per-item resolutions; older servers need a second call.
            const resolve: ResolveResponse = plan.items
              ? { items: plan.items, pendingItemCount: plan.items.filter((i) => i.state === 'needs_info').length }
              : await api.resolve({ state });
            clearTimeout(slowTimer);
            if (mine !== run.current) return;
            // older servers / the mock send no `items` in the plan: attach them so every consumer sees the per-item states
            setData({ resolve, plan: plan.items ? plan : { ...plan, items: resolve.items } });
            setRefreshing(false);
            setSlow(false);
          } catch (e) {
            clearTimeout(slowTimer);
            if (isAborted(e) || mine !== run.current) return;
            setError((e as { messageFa?: string }).messageFa || 'مشکلی پیش آمد؛ دوباره تلاش کن.');
            setRefreshing(false);
            setSlow(false);
          }
        })();
      },
      have.current ? DEBOUNCE_MS : 0,
    );
    return () => {
      clearTimeout(timer);
      clearTimeout(slowTimer);
    };
  }, [key, nonce]);

  // Leaving the screen invalidates anything still in flight.
  useEffect(
    () => () => {
      run.current += 1;
    },
    [],
  );

  // Switching to a different plan must not show the previous plan's numbers.
  useEffect(() => {
    setData(null);
  }, [savedId]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return {
    resolve: data?.resolve ?? null,
    plan: data?.plan ?? null,
    loading: !data && error === null,
    refreshing,
    error: error !== null,
    errorMessage: error,
    slow,
    reload,
  };
}
