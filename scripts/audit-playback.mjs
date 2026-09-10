import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const executablePath = '/home/vixkosla/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';
const hardware = process.argv.includes('--hardware');
const desktopOnly = process.argv.includes('--desktop');
const outputDir = resolve(process.argv.find(argument => argument.startsWith('--output='))
  ?.slice('--output='.length) || 'artifacts/audit');
const browserErrors = [];

await mkdir(outputDir, { recursive: true });

const browser = hardware ? await chromium.connectOverCDP('http://127.0.0.1:9240') : await chromium.launch({
  executablePath,
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu-sandbox',
    '--enable-unsafe-webgpu',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--enable-features=Vulkan',
  ],
});

// A hardware run owns one temporary tab, never the user's viewport/context.
const page = hardware ? await browser.contexts()[0].newPage()
  : await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
if (hardware) await page.setViewportSize({ width: 1920, height: 1080 });
page.on('console', (message) => {
  if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
});
page.on('pageerror', (error) => browserErrors.push(`page: ${error.message}`));

try {
  // Reject software WebGPU even when Chrome's compositor reports an NVIDIA GPU.
  await page.route('**/__webgpu_probe__', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>WebGPU adapter probe</title>',
  }));
  await page.goto('http://127.0.0.1:4321/__webgpu_probe__');
  const adapter = await page.evaluate(async () => {
    const gpu = await navigator.gpu?.requestAdapter();
    return gpu ? { vendor: gpu.info.vendor, architecture: gpu.info.architecture,
      description: gpu.info.description, fallback: gpu.info.isFallbackAdapter } : null;
  });
  assert(adapter, 'No WebGPU adapter available');
  if (hardware) assert(!adapter.fallback && !/swiftshader|llvmpipe/i.test(JSON.stringify(adapter)),
    'Hardware audit requires a physical WebGPU adapter');
  await page.unroute('**/__webgpu_probe__');
  console.log(`WebGPU adapter: ${JSON.stringify(adapter)}`);

  // The root URL now opens the architecture inspector. Explicitly enter film.
  await page.goto('http://127.0.0.1:4321/?film&paused&hud=1', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('body[data-ready="true"]', { timeout: 90_000 });
  assert.equal(await page.locator('body').evaluate(body => body.classList.contains('inspection-mode')), false);
  await page.evaluate(() => {
    const audit = globalThis.__playbackAudit = { samples: [], previousTime: 0, wrapped: false };
    const sample = () => {
      const time = Number(document.body.dataset.time);
      if (audit.previousTime > 24 && time < 2) audit.wrapped = true;
      const previous = audit.samples.at(-1);
      if (!previous || Math.abs(time - previous.time) >= 0.5) {
        audit.samples.push({ time, wall: performance.now(),
          fps: Number(document.querySelector('#perf-fps').value),
          frame: document.querySelector('#perf-frame').value,
          draws: document.querySelector('#perf-draws').value,
          triangles: document.querySelector('#perf-triangles').value });
      }
      audit.previousTime = time;
      if (!audit.wrapped) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  const startedAt = Date.now();
  await page.locator('#play').click();
  await page.waitForFunction(() => globalThis.__playbackAudit.wrapped, undefined, { timeout: 90_000 });
  const wallSeconds = (Date.now() - startedAt) / 1000;
  await page.locator('#play').click();
  await page.waitForFunction(() => document.querySelector('#play').getAttribute('aria-label') === 'Play');
  const pausedTime = await page.evaluate(() => Number(document.body.dataset.time));
  await page.waitForTimeout(350);
  assert.equal(await page.evaluate(() => Number(document.body.dataset.time)), pausedTime, 'Pause must stop film time');
  const playback = await page.evaluate(() => globalThis.__playbackAudit);
  await page.locator('#timeline').evaluate(input => {
    input.value = '25.2';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => Math.abs(Number(document.body.dataset.time) - 25.2) < 0.01);
  await page.screenshot({ path: resolve(outputDir, 'desktop-final-live.png') });

  // Verify the actual mode controls, including RETURN TO FILM restarting playback.
  await page.locator('#inspect-mode').click();
  await page.waitForFunction(() => document.body.classList.contains('inspection-mode'));
  await page.locator('[data-inspect-camera="quarter"]').click();
  assert.equal(await page.locator('[data-inspect-camera="quarter"]').getAttribute('aria-pressed'), 'true');
  await page.locator('#film-mode').click();
  await page.waitForURL('**/?film');
  await page.waitForSelector('body[data-ready="true"]', { timeout: 90_000 });
  await page.waitForFunction(() => Number(document.body.dataset.time) > 0.5);
  assert.equal(await page.locator('body').evaluate(body => body.classList.contains('inspection-mode')), false);
  await page.keyboard.press('Space');

  if (!desktopOnly) {
    await page.setViewportSize({ width: 430, height: 932 });
    for (const time of [0, 18.5, 25.2]) {
      await page.goto(`http://127.0.0.1:4321/?t=${time}&hud=0`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForSelector('body[data-ready="true"]', { timeout: 30_000 });
      await page.waitForFunction(
        (expected) => Math.abs(Number(document.body.dataset.time) - expected) < 0.01,
        time,
        { timeout: 10_000 },
      );
      await page.waitForTimeout(300);
      await page.screenshot({ path: resolve(outputDir, `portrait-${time.toFixed(1).replace('.', '_')}.png`) });
    }
  }

  await writeFile(resolve(outputDir, 'playback.json'), JSON.stringify({ adapter, wallSeconds,
    pausedTime, desktopOnly, ...playback, browserErrors }, null, 2));

  if (browserErrors.length > 0) {
    throw new Error(`Browser errors:\n${browserErrors.join('\n')}`);
  }

  console.log(`PASS: full 26s autoplay loop completed in ${wallSeconds.toFixed(2)}s; wrapped to ${pausedTime.toFixed(3)}s`);
  console.log('PASS: pause, timeline, inspector selection and return to film');
  console.log(`PASS: desktop final${desktopOnly ? '' : ' and portrait keyframes'} captured without browser errors`);
} finally {
  await page.close();
  if (!hardware) await browser.close();
}
// A CDP connection is borrowed; leave its browser and other tabs alive.
if (hardware) process.exit(0);
