// Starts the REAL stack for the real-data e2e suite: builds the web app and the server, then runs the built
// server on $E2E_REAL_PORT against the real market database (it also serves the built web app).
// Env: E2E_REAL_PORT (required), E2E_DB (default: the shared market.sqlite), E2E_SKIP_BUILD=1 to reuse builds.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const port = process.env.E2E_REAL_PORT;
if (!port) throw new Error('E2E_REAL_PORT is required');
const db = process.env.E2E_DB ?? '/home/anon/dev/starCoach-hackathon/Torob/data/market.sqlite';
if (!existsSync(db)) throw new Error(`database not found: ${db}`);

if (!process.env.E2E_SKIP_BUILD) {
  for (const ws of ['@app/web', '@app/server']) {
    const r = spawnSync('npm', ['run', 'build', '-w', ws], { cwd: root, stdio: 'inherit', env: { ...process.env, VITE_API: '' } });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
}

const child = spawn('node', [path.join(root, 'apps/server/dist/server.mjs')], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    PORT: port,
    // all interfaces: the insecure-origin suite opens the app through the machine's LAN IP (127.0.0.1 is a secure context)
    HOST: process.env.E2E_HOST ?? '0.0.0.0',
    NODE_ENV: 'production',
    DATABASE_PATH: db,
    WEB_DIST: path.join(root, 'apps/web/dist'),
    RATE_LIMIT: '100000',
    LLM_API_KEY: '',
    LOG_LEVEL: 'warn',
  },
});
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => child.kill(sig));
child.on('exit', (code) => process.exit(code ?? 0));
