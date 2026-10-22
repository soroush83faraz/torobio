import { createReadStream, existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse';

/** Repository root (scripts/data/src -> ../../..). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Default location of the raw dataset (outside git, sibling of the repo checkout). */
export function defaultCsvDir(): string {
  const env = process.env.DATA_CSV_DIR;
  if (env) return env;
  const candidates = [
    resolve(REPO_ROOT, 'starcoach-dataset-v16-cap300-csv'),
    resolve(REPO_ROOT, '..', 'starcoach-dataset-v16-cap300-csv'),
    // worktrees live in <main>/.claude/worktrees/<name>
    resolve(REPO_ROOT, '..', '..', '..', 'starcoach-dataset-v16-cap300-csv'),
    resolve(REPO_ROOT, '..', '..', '..', '..', 'starcoach-dataset-v16-cap300-csv'),
  ];
  return candidates.find((c) => existsSync(resolve(c, 'shops.csv'))) ?? (candidates[0] as string);
}

/** Resolve a user-supplied path against the directory npm was invoked from. */
export function userPath(p: string): string {
  if (isAbsolute(p)) return p;
  return resolve(process.env.INIT_CWD ?? process.cwd(), p);
}

export type Row = Record<string, string | null>;

/** Stream CSV rows as objects; the literal `null` (and empty) become null. */
export async function* readCsv(path: string): AsyncGenerator<Row> {
  const parser = createReadStream(path).pipe(
    parse({ columns: true, bom: true, relax_quotes: false, skip_empty_lines: true }),
  );
  for await (const rec of parser as AsyncIterable<Record<string, string>>) {
    const row: Row = {};
    for (const [k, v] of Object.entries(rec)) row[k] = v === 'null' || v === '' ? null : v;
    yield row;
  }
}

export function parseJson<T>(s: string | null | undefined): T | null {
  if (s == null) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

export function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i >= 0) return args[i + 1];
  const pref = `${name}=`;
  const a = args.find((x) => x.startsWith(pref));
  return a ? a.slice(pref.length) : undefined;
}
