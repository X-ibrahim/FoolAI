/**
 * Automated screenshot capture for FoolAI README.
 * Usage: node scripts/screenshot.js
 *
 * Launches the Electron app via Playwright, navigates each screen,
 * and saves PNGs to assets/screenshots/.
 */
const { _electron: electron } = require('playwright');
const path = require('path');
const fs   = require('fs');

const OUT_DIR  = path.join(__dirname, '..', 'assets', 'screenshots');
const MAIN_JS  = path.join(__dirname, '..', 'main.js');
const DELAY_MS = 700; // wait after navigation for animations to settle

const pause = ms => new Promise(r => setTimeout(r, ms));

async function save(window, name) {
  const file = path.join(OUT_DIR, name);
  await window.screenshot({ path: file, animations: 'disabled' });
  console.log(`  ✓  ${name}`);
}

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('\nLaunching FoolAI…');
  const app = await electron.launch({
    args: [MAIN_JS],
    cwd: path.join(__dirname, '..'),
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await pause(1800); // let fonts + fade-in animation finish

  console.log('\nCapturing screenshots…');

  // ── 1. Home / mode selector ──────────────────────
  await save(win, '01-home.png');

  // ── 2. Humanize ──────────────────────────────────
  await win.click('#btn-mode-humanize');
  await pause(DELAY_MS);
  await save(win, '02-humanize.png');
  await win.click('#back-humanize');
  await pause(DELAY_MS);

  // ── 3. Watermark ─────────────────────────────────
  await win.click('#btn-mode-watermark');
  await pause(DELAY_MS);
  await save(win, '03-watermark.png');
  await win.click('#back-watermark');
  await pause(DELAY_MS);

  // ── 4. Upscale ───────────────────────────────────
  await win.click('#btn-mode-upscale');
  await pause(DELAY_MS);
  await save(win, '04-upscale.png');

  await app.close();
  console.log(`\nAll screenshots saved to assets/screenshots/\n`);
}

run().catch(err => { console.error(err); process.exit(1); });
