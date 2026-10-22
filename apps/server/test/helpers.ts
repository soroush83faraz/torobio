import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildApp, type BuildOptions } from '../src/app.js';
import { loadConfig, type Config } from '../src/config.js';

const dirs: string[] = [];

export function tmpDir(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'bazaar-server-test-'));
  dirs.push(d);
  return d;
}

export function cleanupTmp(): void {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
}

/** Tiny stand-in for market.sqlite: only the meta table (never the real dataset). */
export function makeFixtureDb(file: string): string {
  const db = new Database(file);
  db.exec('CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT)');
  const ins = db.prepare('INSERT INTO meta VALUES (?, ?)');
  ins.run('snapshot_date', '2026-10-13');
  ins.run('data_version', 'test-1');
  ins.run('build_time', '2026-10-14T00:00:00Z');
  ins.run('counts', JSON.stringify({ products: 12, shops: 3 }));
  ins.run('count_offers', '40');
  db.close();
  return file;
}

export function testConfig(overrides: Partial<Config> = {}): Config {
  const dir = tmpDir();
  return {
    ...loadConfig({ NODE_ENV: 'test' }, dir),
    databasePath: path.join(dir, 'missing.sqlite'),
    webDist: path.join(dir, 'no-web'),
    ...overrides,
  };
}

export async function makeApp(overrides: Partial<Config> = {}, extra: Partial<BuildOptions> = {}) {
  const config = testConfig(overrides);
  const built = await buildApp({ config, ...extra });
  await built.app.ready();
  return built;
}
