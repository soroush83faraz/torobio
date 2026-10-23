/**
 * The single API boundary. The UI imports ONLY from here (and from ./types).
 *
 * Default adapter: real HTTP (same-origin /api). The mock stays available for tests and screenshots:
 *   - `?mock=1` in the page URL (remembered for the tab session), or
 *   - a build with `VITE_API=mock`.
 * The mock engine is loaded lazily, so a normal production load never downloads it.
 */
import type {
  AssistRequest,
  AssistResponse,
  AssistResult,
  MetaResponse,
  OptionsRequest,
  OptionsResponse,
  ParseRequest,
  ParseResponse,
  PlacesRequest,
  PlacesResponse,
  PlanRequest,
  PlanResponse,
  RequirementState,
  ResolveRequest,
  ResolveResponse,
} from './types';
import { sanitizeText } from '../lib/sanitize';
import { normalizeAssist } from './assistState';
import { httpAdapter } from './http';

export interface ApiAdapter {
  parse(req: ParseRequest): Promise<ParseResponse>;
  resolve(req: ResolveRequest): Promise<ResolveResponse>;
  options(req: OptionsRequest): Promise<OptionsResponse>;
  plan(req: PlanRequest): Promise<PlanResponse>;
  places(req: PlacesRequest): Promise<PlacesResponse>;
  assist(req: AssistRequest): Promise<AssistResponse>;
  meta(): Promise<MetaResponse>;
}

const MOCK_FLAG = 'api:mock';

/** True when this page load should use the mock adapter. */
export function wantsMock(): boolean {
  try {
    if (import.meta.env.VITE_API === 'mock') return true;
    if (typeof window === 'undefined') return false;
    if (new URLSearchParams(window.location.search).get('mock') === '1') {
      try {
        sessionStorage.setItem(MOCK_FLAG, '1');
      } catch {
        /* ignore */
      }
      return true;
    }
    try {
      return sessionStorage.getItem(MOCK_FLAG) === '1';
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

let mockPromise: Promise<ApiAdapter> | null = null;
const loadMock = () => (mockPromise ??= import('./mock/adapter').then((m) => m.mockAdapter));

/** Lazy mock: same interface, loaded on first use. */
export const lazyMockAdapter: ApiAdapter = {
  parse: async (r) => (await loadMock()).parse(r),
  resolve: async (r) => (await loadMock()).resolve(r),
  options: async (r) => (await loadMock()).options(r),
  plan: async (r) => (await loadMock()).plan(r),
  places: async (r) => (await loadMock()).places(r),
  assist: async (r) => (await loadMock()).assist(r),
  meta: async () => (await loadMock()).meta(),
};

let adapter: ApiAdapter = wantsMock() ? lazyMockAdapter : httpAdapter;

/** Swap the adapter (tests, or a failing one in specs). */
export function setApiAdapter(next: ApiAdapter) {
  adapter = next;
}

/** True while the mock is serving (the about sheet says so honestly). */
export const isMockApi = (): boolean => adapter === lazyMockAdapter;

export const api = {
  /** User text is sanitised here, once, before it can reach any adapter (bidi overrides / control characters). */
  parse: (req: ParseRequest) => adapter.parse({ ...req, text: sanitizeText(req.text) }),
  resolve: (req: ResolveRequest) => adapter.resolve(req),
  options: (req: OptionsRequest) => adapter.options(req),
  plan: (req: PlanRequest) => adapter.plan(req),
  /**
   * «کجا بروم»: buildings ranked for the whole list (best first, at most 8) and a one-line recommendation.
   * Items still waiting on a question are evaluated with their default pick. A newer call aborts the previous one.
   */
  places: (state: RequirementState) => adapter.places({ state }),
  /** Always resolves with the state after the action (`newState`) and whether anything changed. */
  assist: async (req: AssistRequest): Promise<AssistResult> => {
    const clean = req.text === undefined ? req : { ...req, text: sanitizeText(req.text) };
    return normalizeAssist(clean, await adapter.assist(clean));
  },
  meta: () => adapter.meta(),
};
