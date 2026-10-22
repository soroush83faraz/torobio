import type { ParsedItem, ParseRefiner, RefineContext } from '../src/parse/index.js';

/** Test double for the LLM refinement hook: configurable delay / failure / output, records what it saw. */
export class FakeRefiner {
  calls = 0;
  lastContext: RefineContext | undefined;
  lastItems: ParsedItem[] | undefined;
  /** Becomes true when the late result was actually produced (after the delay). */
  finished = false;
  aborted = false;

  constructor(
    private readonly opts: {
      delayMs?: number;
      throws?: boolean;
      /** Build the output from the (deep-copied) draft items. Default: identity. */
      output?: (items: ParsedItem[], ctx: RefineContext) => unknown;
    } = {},
  ) {}

  readonly refine: ParseRefiner = async (items, ctx) => {
    this.calls += 1;
    this.lastContext = ctx;
    this.lastItems = items;
    ctx.signal.addEventListener('abort', () => (this.aborted = true));
    if (this.opts.delayMs) await new Promise((r) => setTimeout(r, this.opts.delayMs));
    if (this.opts.throws) throw new Error('boom');
    const out = this.opts.output ? this.opts.output(items, ctx) : items;
    this.finished = true;
    return out as ParsedItem[];
  };
}
