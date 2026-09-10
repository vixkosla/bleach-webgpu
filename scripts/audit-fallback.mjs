// These denied-capability contexts never create a GPUDevice or render a scene.
// Start CDP9240, then: node scripts/audit-fallback.mjs http://localhost:4322
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.argv[2] ?? 'http://127.0.0.1:4322';
const dir = 'artifacts/fallback';
await mkdir(dir, { recursive: true });
const browser = await chromium.connectOverCDP('http://127.0.0.1:9240');
const results = [];
const cases = [
  ['browser', 1280, 800], ['mobile', 390, 844], ['adapter', 1280, 800],
  ['rejected', 1280, 800], ['adapter-race', 1280, 800],
  ['device-rejected', 1280, 800], ['https', 390, 844],
];
try {
  for (const [name, width, height] of cases) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    try {
      await page.addInitScript(mode => {
        globalThis.__gpuAudit = { adapters: 0, devices: 0, webgl: 0 };
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
          if (/webgl/i.test(kind)) {
            globalThis.__gpuAudit.webgl++;
            throw new Error('WebGL must never be requested');
          }
          return getContext.call(this, kind, ...args);
        };
        if (mode === 'https') return;
        Object.defineProperty(navigator, 'gpu', {
          configurable: true,
          value: ['browser', 'mobile'].includes(mode) ? undefined : {
            requestAdapter: async () => {
              const audit = globalThis.__gpuAudit;
              audit.adapters++;
              if (mode === 'rejected') throw new Error('Adapter unavailable');
              if (mode === 'adapter-race' && audit.adapters > 1) return null;
              if (['adapter-race', 'device-rejected'].includes(mode)) return {
                features: new Set(),
                requestDevice: async () => {
                  audit.devices++;
                  throw new Error('Device unavailable');
                },
              };
              return null;
            },
          },
        });
      }, name);
      if (name === 'https') {
        await context.route('http://scene.invalid/**', async route => {
          const u = new URL(route.request().url());
          await route.fulfill({ response: await context.request.get(base + u.pathname + u.search) });
        });
      }
      await page.goto(name === 'https' ? 'http://scene.invalid/' : base);
      await page.locator('#unsupported h1').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#unsupported').getAttribute('role'), 'alert');
      assert.match(await page.locator('#unsupported').innerText(), /WebGPU/);
      assert.doesNotMatch(await page.locator('#unsupported').innerText(), /Chrome|Google/);
      for (const selector of ['#loading', '#performance-monitor', '#controls', '#cinema']) {
        assert.equal(await page.locator(selector).isVisible(), false);
      }
      const expected = name === 'mobile' ? 'browser'
        : ['rejected', 'adapter-race', 'device-rejected'].includes(name) ? 'adapter' : name;
      const state = await page.evaluate(() => ({
        reason: document.body.dataset.gpu, ready: document.body.dataset.ready,
        renderer: document.body.dataset.renderer, scene: !!globalThis.__threefxDebug,
        ...globalThis.__gpuAudit,
      }));
      assert.equal(state.reason, expected);
      assert.equal(state.ready, 'false');
      assert.equal(state.renderer, undefined);
      assert.equal(state.scene, false);
      assert.equal(state.webgl, 0);
      if (name === 'adapter-race') assert.equal(state.adapters, 2);
      if (name === 'device-rejected') assert.equal(state.devices, 1);
      const links = page.locator('.fallback-actions a');
      if (name === 'https') assert.equal(await links.getAttribute('href'), 'https://bleach-webgpu.vercel.app/');
      else assert.equal(await links.count(), 0);
      const bounds = await page.locator('.fallback-card').boundingBox();
      assert(bounds.x >= 0 && bounds.x + bounds.width <= width + .1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const navigation = page.waitForEvent('framenavigated', f => f === page.mainFrame());
      await page.getByRole('button', { name: 'Проверить снова' }).click();
      await navigation;
      await page.locator('#unsupported h1').waitFor({ state: 'visible' });
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `${dir}/${name}.png` });
      results.push({ name, passed: true, width, height, retry: true, ...state });
      console.log(name);
    } finally {
      await context.close();
    }
  }
} finally {
  await writeFile(`${dir}/report.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
