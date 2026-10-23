/// <reference types="vitest" />
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { buildIdFor, renderServiceWorker } from './sw/render';

/**
 * Writes dist/sw.js from sw/sw.template.js after the build: the precache list is the built shell (index.html, every
 * file under assets/, the favicon) and the build id is a hash of their names and of index.html, so each deploy gets
 * a new worker and a new cache (the old one is deleted on activate). See sw/sw.template.js for the rules.
 */
function shellServiceWorker(): Plugin {
  let outDir = '';
  return {
    name: 'shell-service-worker',
    apply: 'build',
    configResolved(cfg) {
      outDir = path.resolve(cfg.root, cfg.build.outDir);
    },
    closeBundle() {
      const assets = readdirSync(path.join(outDir, 'assets')).filter((f) => !f.endsWith('.map')).sort();
      const urls = ['/', '/favicon.svg', ...assets.map((f) => `/assets/${f}`)];
      const template = readFileSync(path.join(__dirname, 'sw', 'sw.template.js'), 'utf8');
      const sw = renderServiceWorker(template, buildIdFor(readFileSync(path.join(outDir, 'index.html')), urls), urls);
      writeFileSync(path.join(outDir, 'sw.js'), sw);
    },
  };
}

export default defineConfig({
  plugins: [react(), shellServiceWorker()],
  server: { host: true, port: 5173, proxy: { '/api': 'http://127.0.0.1:8080' } },
  preview: { port: 4173 },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
