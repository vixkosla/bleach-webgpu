// One isolated review browser; reuse an existing CDP endpoint without reload.
// Run after the dev server: node scripts/start-review-browser.mjs
import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const endpoint = 'http://127.0.0.1:9240';
const sceneUrl = 'http://127.0.0.1:4321/?inspect=upper&ao-only=1&debug=1';
const running = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1000) })
  .then(response => response.ok).catch(() => false);
if (running) {
  console.log(`Review browser already available at ${endpoint}; no new tab, navigation or restart.`);
  process.exit(0);
}
const server = await fetch('http://127.0.0.1:4321/', { signal: AbortSignal.timeout(2000) })
  .then(response => response.ok).catch(() => false);
if (!server) throw new Error('Start the project first: pnpm dev (port 4321).');
const profile = process.env.BLEACH_REVIEW_PROFILE ?? join(tmpdir(), 'bleach-review-sandboxed');
const logPath = join(tmpdir(), 'bleach-review-browser.log');
const args = [
  '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9240',
  `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--lang=ru', '--start-maximized',
  // Initialize Vulkan before GPU sandboxing, but keep the window compositor
  // on OpenGL. This combination was verified on NVIDIA Pascal / GNOME.
  ...(process.platform === 'linux' ? ['--ozone-platform=x11', '--enable-features=Vulkan', '--disable-vulkan-surface'] : []),
  sceneUrl,
];
// No --disable-gpu-sandbox, --no-sandbox, --enable-unsafe-webgpu,
// --use-angle=vulkan, --ignore-gpu-blocklist or warning-suppression switches.
const log = openSync(logPath, 'a');
const child = spawn(process.env.BLEACH_CHROME ?? chromium.executablePath(), args, {
  detached: true, stdio: ['ignore', log, log],
});
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.unref();
closeSync(log);
console.log(`Started isolated review browser (PID ${child.pid}); log: ${logPath}`);
for (let attempt = 0; attempt < 30; attempt++) {
  await new Promise(resolve => setTimeout(resolve, 500));
  const ready = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(500) })
    .then(response => response.ok).catch(() => false);
  if (ready) {
    console.log(`Open: ${sceneUrl}\nKeep ONE live scene tab. Startup includes geometry generation.`);
    process.exit(0);
  }
}
throw new Error(`Browser did not start. Inspect ${logPath}; sandboxing was not disabled automatically.`);
