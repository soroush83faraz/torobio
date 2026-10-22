import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';

type Statement = Database.Statement;

/**
 * Read-only handle to market.sqlite. When the file is missing or unreadable the server still
 * starts: `present` is false and `prepare()` throws DbUnavailableError (routes map it to 503).
 */
export interface Db {
  readonly present: boolean;
  /** Why the DB is unavailable (never contains user data). */
  readonly reason: string | null;
  /** Cached prepared statement. SQL must be a constant; user input goes through bound parameters only. */
  prepare(sql: string): Statement;
  close(): void;
}

export class DbUnavailableError extends Error {
  constructor() {
    super('database unavailable');
    this.name = 'DbUnavailableError';
  }
}

export function openDb(file: string): Db {
  if (!existsSync(file)) return unavailable('missing');
  let handle: Database.Database;
  try {
    handle = new Database(file, { readonly: true, fileMustExist: true });
    handle.pragma('query_only = ON');
    handle.pragma('mmap_size = 268435456');
    // Cheap sanity check that this is a SQLite file with our meta table.
    handle.prepare('SELECT 1 FROM meta LIMIT 1').get();
  } catch (err) {
    return unavailable(err instanceof Error ? err.message.slice(0, 120) : 'open failed');
  }
  const cache = new Map<string, Statement>();
  return {
    present: true,
    reason: null,
    prepare(sql) {
      let st = cache.get(sql);
      if (!st) {
        st = handle.prepare(sql);
        cache.set(sql, st);
      }
      return st;
    },
    close() {
      cache.clear();
      if (handle.open) handle.close();
    },
  };
}

function unavailable(reason: string): Db {
  return {
    present: false,
    reason,
    prepare() {
      throw new DbUnavailableError();
    },
    close() {},
  };
}
