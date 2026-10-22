import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildIdFor, renderServiceWorker } from '../../sw/render';
import { buildWeb } from '../../sw/testBuild';

const TEMPLATE = readFileSync(path.resolve(__dirname, '../../sw/sw.template.js'), 'utf8');

describe('service worker template', () => {
  it('has each placeholder exactly once, as code (not in a comment)', () => {
    for (const token of ['__BUILD_ID__', '__PRECACHE__']) expect(TEMPLATE.split(token).length - 1, token).toBe(1);
    expect(TEMPLATE).toMatch(/^const BUILD_ID = '__BUILD_ID__';$/m);
    expect(TEMPLATE).toMatch(/^const PRECACHE = __PRECACHE__;$/m);
  });

  it('renders the code constant, not a comment, and leaves no placeholder behind', () => {
    const out = renderServiceWorker(TEMPLATE, 'abcdef012345', ['/', '/assets/a.js']);
    expect(out).toContain("const BUILD_ID = 'abcdef012345';");
    expect(out).toContain('const PRECACHE = ["/","/assets/a.js"];');
    expect(out).not.toContain('__BUILD_ID__');
    expect(out).not.toContain('__PRECACHE__');
  });

  it('refuses a template where a placeholder also sits in a comment (the old bug), or is missing', () => {
    const commented = `/* the id is __BUILD_ID__ */\n${TEMPLATE}`;
    expect(() => renderServiceWorker(commented, 'abcdef012345', [])).toThrow(/exactly once/);
    expect(() => renderServiceWorker(TEMPLATE.replace('__PRECACHE__', '[]'), 'abcdef012345', [])).toThrow(/exactly once/);
  });

  it('the build id depends on the shell: other file names or html give another id', () => {
    const a = buildIdFor('<html>a</html>', ['/', '/assets/x-1.js']);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(buildIdFor('<html>a</html>', ['/', '/assets/x-1.js'])).toBe(a);
    expect(buildIdFor('<html>a</html>', ['/', '/assets/x-2.js'])).not.toBe(a);
    expect(buildIdFor('<html>b</html>', ['/', '/assets/x-1.js'])).not.toBe(a);
  });
});

describe('built dist/sw.js', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'sw-build-'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  const cacheName = (sw: string) => {
    const id = /^const BUILD_ID = '([^']*)';$/m.exec(sw)?.[1];
    return id === undefined ? undefined : `shell-${id}`;
  };

  it('two builds with different bundles get different, fully resolved cache names', async () => {
    const outA = path.join(tmp, 'a');
    const outB = path.join(tmp, 'b');
    await buildWeb(outA, 'A');
    await buildWeb(outB, 'B');
    const swA = readFileSync(path.join(outA, 'sw.js'), 'utf8');
    const swB = readFileSync(path.join(outB, 'sw.js'), 'utf8');
    for (const sw of [swA, swB]) {
      expect(sw).not.toContain('__BUILD_ID__');
      expect(sw).not.toContain('__PRECACHE__');
    }
    const [nameA, nameB] = [cacheName(swA), cacheName(swB)];
    expect(nameA).toMatch(/^shell-[0-9a-f]{12}$/);
    expect(nameB).toMatch(/^shell-[0-9a-f]{12}$/);
    expect(nameA).not.toBe(nameB);
    // the precache list is the built shell of that build
    const jsA = readdirSync(path.join(outA, 'assets')).find((f) => f.endsWith('.js'))!;
    expect(swA).toContain(`/assets/${jsA}`);
    expect(swB).not.toContain(`/assets/${jsA}`);
  }, 120_000);
});
