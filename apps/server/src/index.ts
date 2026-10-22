import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { prewarm } from './warm.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const { app, ctx } = await buildApp({ config });

  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, 'shutting down');
    app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
    setTimeout(() => process.exit(1), 8000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await app.listen({ port: config.port, host: config.host });
  app.log.info(
    { port: config.port, db: ctx.db.present, dbReason: ctx.db.reason, llm: ctx.llm.configured, env: config.nodeEnv },
    'server ready',
  );
  // after readiness: load the demo categories' pools in the background (one per event-loop turn)
  if (process.env.PREWARM !== '0') prewarm(ctx, app.log);
}

main().catch((err: unknown) => {
  // Config errors list variable names only, never values.
  const issues = (err as { issues?: { path: unknown[] }[] } | null)?.issues;
  console.error(
    JSON.stringify({
      level: 'fatal',
      msg: 'startup failed',
      error: err instanceof Error ? err.name : 'unknown',
      fields: issues?.map((i) => i.path.join('.')),
    }),
  );
  process.exit(1);
});
