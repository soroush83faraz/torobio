import { useEffect, useState } from 'react';
import { t } from '../copy/fa';
import { isMockApi } from './client';
import type { DegradedReason } from './types';

/**
 * Whether the server has a language model configured (GET /api/health `llm`). `null` = not known (mock build, request
 * failed). Asked once per page load; the answer only changes the wording of the assistant sheet.
 */
let pending: Promise<boolean | null> | null = null;

export function llmConfigured(): Promise<boolean | null> {
  if (isMockApi()) return Promise.resolve(null);
  pending ??= fetch('/api/health', { credentials: 'omit', headers: { accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: unknown) => (j && typeof j === 'object' && typeof (j as { llm?: unknown }).llm === 'boolean' ? (j as { llm: boolean }).llm : null))
    .catch(() => {
      pending = null; // try again next time (the server may just be starting)
      return null;
    });
  return pending;
}

/** Test hook. */
export function resetLlmConfigured() {
  pending = null;
}

export function useLlmConfigured(): boolean | null {
  const [llm, setLlm] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void llmConfigured().then((v) => alive && setLlm(v));
    return () => {
      alive = false;
    };
  }, []);
  return llm;
}

/**
 * Which kind of «simple answer» this is. The server's `degradedReason` wins; a missing one is read from /api/health:
 * no model configured = a mode ('not_configured'), anything else = a failure.
 */
export function degradedKind(reason: DegradedReason | undefined, llm: boolean | null): DegradedReason {
  return reason ?? (llm === false ? 'not_configured' : 'failed');
}

export const degradedText = (kind: DegradedReason): string =>
  kind === 'not_configured' ? t.assistant.simpleMode : kind === 'budget' ? t.assistant.budget : t.assistant.degraded;
