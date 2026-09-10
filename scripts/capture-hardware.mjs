import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const [outputArgument, ...timeArguments] = process.argv.slice(2);
if (!outputArgument || timeArguments.length === 0) {
  throw new Error('Usage: node scripts/capture-hardware.mjs <output-dir> <time...>');
}

const times = timeArguments.map(Number).filter(Number.isFinite);
const outputDir = resolve(outputArgument);
const browserErrors = [];
await mkdir(outputDir, { recursive: true });

// The desktop Chrome owns the hardware WebGPU device. Always create and close
// an ephemeral tab: changing the viewport of the user's persistent tab is what
// caused the old narrow-canvas regression.
const browser = await chromium.connectOverCDP('http://127.0.0.1:9240');
const context = browser.contexts()[0];
if (!context) throw new Error('No persistent Chrome context on port 9240');
const page = await context.newPage();
await page.setViewportSize({ width: 1920, height: 1080 });
page.on('console', (message) => {
  if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
});
page.on('pageerror', (error) => browserErrors.push(`page: ${error.message}`));

try {
  // Reuse one renderer/device. Repeated navigation can retain the previous
  // scene's GPU allocations while the next 4096px shadow map is created.
  await page.goto(`http://127.0.0.1:4321/?t=${times[0]}&paused&hud=0`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  await page.waitForSelector('body[data-ready="true"]', { timeout: 45_000 });
  await page.bringToFront();
  for (const time of times) {
    await page.locator('#timeline').evaluate((input, value) => {
      input.value = String(value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, time);
    await page.waitForFunction(
      (expected) => Math.abs(Number(document.body.dataset.time) - expected) < 0.01,
      time,
      { timeout: 15_000 },
    );
    await page.waitForTimeout(2200);
    if (browserErrors.length) throw new Error(browserErrors.slice(0, 3).join('\n'));
    const filename = `t-${time.toFixed(2).replace('.', '_')}.png`;
    // Screenshot readback can stall the frame loop. Sample its HUD first.
    const performance = await page.locator('#performance-monitor').innerText();
    await page.screenshot({ path: resolve(outputDir, filename), timeout: 120_000 });
    await writeFile(resolve(outputDir, filename.replace('.png', '.json')), JSON.stringify({
      time, errors: browserErrors, performance,
    }, null, 2));
    console.log(`${time.toFixed(2)}s -> ${filename}`);
  }
} finally {
  await page.close();
}
if (browserErrors.length > 0) {
  console.error(browserErrors.join('\n'));
  process.exit(1);
}
console.log('PASS: hardware WebGPU keyframes captured without browser errors');
process.exit(0);
