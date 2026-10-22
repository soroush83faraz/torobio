import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * A FAKE `claude` executable for the claude-cli backend tests: a small Node script (absolute shebang, so it runs
 * with the client's minimal PATH) that records what it received (argv, env, cwd and its entries, stdin, the system
 * prompt file) and then plays a scenario on stdout (stream-json events, junk, a flood, a hang...).
 * The real CLI is never involved.
 */

export type FakeLine = Record<string, unknown> | string;

export interface FakeCliScenario {
  /** Printed one per line after stdin is read (objects as JSON, strings verbatim). */
  lines?: FakeLine[];
  /** Wait this long before printing. */
  delayMs?: number;
  /** Exit code after printing (default 0). */
  exitCode?: number;
  /** After printing, never exit on its own. */
  hang?: boolean;
  /** Start a long-lived grandchild in the same process group (its pid is recorded). */
  grandchild?: boolean;
  /** Ignore SIGTERM (only SIGKILL ends it). */
  ignoreTerm?: boolean;
  /** After `lines`, print about this many bytes of valid JSON events. */
  floodBytes?: number;
  /** Answer a parse prompt by echoing its <draft> items as structured output (end-to-end tests). */
  echoDraft?: boolean;
}

export interface FakeCliRecord {
  argv: string[];
  env: Record<string, string>;
  cwd: string;
  cwdEntries: string[];
  stdin: string;
  systemFile: string | null;
  system: string | null;
  systemMode: number | null;
  pid: number;
  grandchildPid?: number;
}

export interface FakeCli {
  bin: string;
  records(): FakeCliRecord[];
}

let n = 0;

export function writeFakeCli(dir: string, scenario: FakeCliScenario): FakeCli {
  n += 1;
  const bin = path.join(dir, `fake-claude-${n}.cjs`);
  const recordFile = path.join(dir, `fake-claude-${n}.records.ndjson`);
  const src = `#!${process.execPath}
'use strict';
const fs = require('fs');
const cp = require('child_process');
const S = ${JSON.stringify(scenario)};
const RECORD = ${JSON.stringify(recordFile)};
const chunks = [];
process.stdin.on('data', (d) => chunks.push(d));
process.stdin.on('end', () => {
  const stdin = Buffer.concat(chunks).toString('utf8');
  const sysArg = process.argv.find((a) => a.startsWith('--system-prompt-file='));
  const systemFile = sysArg ? sysArg.slice('--system-prompt-file='.length) : null;
  let system = null;
  let systemMode = null;
  try { system = fs.readFileSync(systemFile, 'utf8'); systemMode = fs.statSync(systemFile).mode & 0o777; } catch (e) {}
  const rec = { argv: process.argv.slice(2), env: Object.assign({}, process.env), cwd: process.cwd(), cwdEntries: fs.readdirSync('.'), stdin, systemFile, system, systemMode, pid: process.pid };
  if (S.grandchild) {
    const g = cp.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    rec.grandchildPid = g.pid;
  }
  if (S.ignoreTerm) process.on('SIGTERM', () => {});
  fs.appendFileSync(RECORD, JSON.stringify(rec) + '\\n');
  const out = (l) => process.stdout.write((typeof l === 'string' ? l : JSON.stringify(l)) + '\\n');
  const go = () => {
    for (const l of S.lines || []) out(l);
    if (S.echoDraft) {
      const m = /<draft>\\n([\\s\\S]*?)\\n<\\/draft>/.exec(stdin);
      const draft = m ? JSON.parse(m[1]) : { items: [] };
      const items = draft.items.map((d) => ({ id: d.id, from_id: null, text: d.text, qty: d.qty, category_ids: d.category_ids, constraints: d.constraints }));
      const so = { items };
      out({ type: 'system', subtype: 'init', tools: ['StructuredOutput'], mcp_servers: [], permissionMode: 'dontAsk' });
      out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'StructuredOutput', input: so }] } });
      out({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(so), structured_output: so });
    }
    if (S.floodBytes) {
      const line = JSON.stringify({ type: 'stream_event', pad: 'x'.repeat(4000) }) + '\\n';
      let sent = 0;
      while (sent < S.floodBytes) { process.stdout.write(line); sent += line.length; }
    }
    if (S.hang) { setInterval(() => {}, 1000); return; }
    process.exitCode = S.exitCode || 0;
  };
  if (S.delayMs) setTimeout(go, S.delayMs); else go();
});
`;
  writeFileSync(bin, src, { mode: 0o755 });
  return {
    bin,
    records: () =>
      existsSync(recordFile)
        ? readFileSync(recordFile, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((l) => JSON.parse(l) as FakeCliRecord)
        : [],
  };
}

// --- stream-json events as Claude Code 2.1.306 prints them (trimmed to the fields the client reads) ----------------

export const initEvent = (tools: string[] = ['StructuredOutput'], extra: Record<string, unknown> = {}) => ({
  type: 'system',
  subtype: 'init',
  cwd: '/x',
  session_id: 's',
  tools,
  mcp_servers: [],
  model: 'claude-haiku-5-5',
  permissionMode: 'dontAsk',
  apiKeySource: 'none',
  ...extra,
});

export const toolUseEvent = (input: unknown, name = 'StructuredOutput') => ({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', id: 'toolu_1', name, input }] },
});

export const toolResultEvent = () => ({
  type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'Structured output provided successfully' }] },
});

export const resultEvent = (structured: unknown, extra: Record<string, unknown> = {}) => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  api_error_status: null,
  num_turns: 2,
  result: JSON.stringify(structured),
  structured_output: structured,
  ...extra,
});

/** The event sequence of a successful structured-output call. */
export const okLines = (structured: unknown): FakeLine[] => [
  { type: 'system', subtype: 'ui_invalidate' },
  initEvent(),
  toolUseEvent(structured),
  toolResultEvent(),
  { type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } },
  resultEvent(structured),
];
