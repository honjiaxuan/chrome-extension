// 一次性截图：加载未打包扩展并打开设置页，用于人工看一眼布局
//   NODE_PATH=/home/hjx/node_modules node scripts/shot-settings.mjs /tmp/settings.png
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = process.argv[2] || '/tmp/hjx-settings.png';
const profile = mkdtempSync(join(tmpdir(), 'hjx-shot-'));

const context = await chromium.launchPersistentContext(profile, {
  headless: true,
  channel: 'chromium',
  viewport: { width: 1280, height: 900 },
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--no-sandbox']
});

let sw = context.serviceWorkers()[0];
if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
const extensionId = new URL(sw.url()).host;
const page = await context.newPage();
await page.goto(`chrome-extension://${extensionId}/settings.html`);
await page.waitForSelector('#tab-overflow');
await page.waitForTimeout(500);
await page.screenshot({ path: out, fullPage: true });
console.log(out + ' ' + (await page.locator('.card').count()) + ' cards');

await context.close();
rmSync(profile, { recursive: true, force: true });
