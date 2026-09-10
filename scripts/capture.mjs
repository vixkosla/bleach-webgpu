import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const executablePath = '/home/vixkosla/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';
const outputDir = resolve('artifacts/storyboard');
const times = process.argv.slice(2).map(Number).filter(Number.isFinite);

await mkdir(outputDir, { recursive: true });

const launchArgs = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu-sandbox',
  '--enable-unsafe-webgpu',
  '--use-angle=swiftshader',
  '--enable-features=Vulkan',
];

for (const time of times) {
  // SwiftShader drops the WebGPU device if one Chromium instance renders several
  // heavy frames. Launch a fresh process per still.
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: launchArgs,
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(`[browser] ${message.text()}`);
  });
  page.on('pageerror', (error) => console.error(`[page] ${error.message}`));

  const url = `http://127.0.0.1:4321/?t=${time}&hud=0`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('body[data-ready="true"]', { timeout: 60_000 });
  await page.waitForFunction(
    (expected) => Math.abs(Number(document.body.dataset.time) - expected) < 0.01,
    time,
    { timeout: 60_000 },
  );
  await page.waitForTimeout(450);
  const filename = `t-${time.toFixed(2).replace('.', '_')}.png`;
  await page.screenshot({ path: resolve(outputDir, filename), timeout: 180_000 });
  console.log(`${time.toFixed(2)}s -> ${filename}`);
  await browser.close();
}
