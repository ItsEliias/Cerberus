/**
 * CerberusOS Home Shell — browser smoke test
 *
 * Usage:
 *   node tests/cerberus-home-shell.mjs <password>
 *
 * The test logs in as admin, opens the CerberusOS home shell via the
 * brain rail button, checks that the globe nodes render correctly, and
 * verifies that clicking nodes opens modals without JS errors.
 *
 * Requires: @playwright/test  (already present in the repo)
 * Run:  node tests/cerberus-home-shell.mjs yourpassword
 */

import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const BASE   = 'http://127.0.0.1:7000';
const PASS   = process.argv[2] || '';
const SHOTS  = '/tmp/cerberus-test-';

if (!PASS) {
  console.error('Usage: node tests/cerberus-home-shell.mjs <password>');
  process.exit(1);
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const errors   = [];
  const warnings = [];
  page.on('console', msg => {
    if (msg.type() === 'error')   errors.push(msg.text());
    if (msg.type() === 'warning') warnings.push(msg.text());
  });
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));

  try {
    // ── 1. Login ──────────────────────────────────────────────────────────
    console.log('⏳ Loading login page…');
    await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 15000 });
    await page.screenshot({ path: SHOTS + '1-login.png' });

    // Fill credentials — username is always "admin" for Cerberus
    const userInput = page.locator('input[name="username"], input[type="text"]').first();
    const passInput = page.locator('input[name="password"], input[type="password"]').first();
    if (await userInput.count()) await userInput.fill('admin');
    if (await passInput.count()) await passInput.fill(PASS);

    // Submit
    const submit = page.locator('button[type="submit"], input[type="submit"]').first();
    await Promise.all([page.waitForNavigation({ timeout: 10000 }).catch(() => {}), submit.click()]);
    await page.screenshot({ path: SHOTS + '2-after-login.png' });

    const url = page.url();
    if (url.includes('/login')) {
      console.error('❌ Login failed — still on /login. Check your password.');
      await browser.close();
      process.exit(1);
    }
    console.log('✅ Logged in →', url);

    // ── 2. Open home shell ────────────────────────────────────────────────
    console.log('⏳ Clicking brain rail button…');
    const brainBtn = page.locator('#rail-cerberus-home');
    if (!await brainBtn.count()) {
      console.error('❌ Brain rail button not found in DOM');
    } else {
      await page.evaluate(() => document.getElementById('rail-cerberus-home')?.click());
      await page.waitForTimeout(1500);
      await page.screenshot({ path: SHOTS + '3-home-shell.png' });

      // Check #cerberus-home is visible
      const homeVisible = await page.locator('#cerberus-home').evaluate(el =>
        !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none'
      );
      console.log(homeVisible ? '✅ #cerberus-home visible' : '❌ #cerberus-home still hidden');

      // Check globe nodes
      const nodeCount = await page.locator('.cerberus-os-node-wrap').count();
      console.log(`✅ Globe nodes: ${nodeCount} cerberus-os-node-wrap elements`);

      // Old atlas nodes should NOT exist
      const oldNodeCount = await page.locator('.atlas-os-node-wrap').count();
      if (oldNodeCount) console.error(`❌ Found ${oldNodeCount} old atlas-os-node-wrap elements!`);

      // ── 3. Click a globe node (first one) ───────────────────────────────
      if (nodeCount > 0) {
        const firstNode = page.locator('.cerberus-os-node-wrap').first();
        const label = await firstNode.locator('.cerberus-os-node-label').textContent().catch(() => '?');
        console.log(`⏳ Clicking globe node: "${label.trim()}"…`);
        await firstNode.click({ force: true });
        await page.waitForTimeout(1000);
        await page.screenshot({ path: SHOTS + '4-node-click.png' });

        // Check if a modal opened
        const openModal = await page.locator('.cerberus-shell-modal--open, .cerberus-hq-modal:not(.hidden), .cerberus-shell-panel-active').count();
        console.log(openModal ? `✅ Modal opened (${openModal} visible)` : '⚠️  No modal opened after node click');
      }
    }

    // ── 4. Summary ────────────────────────────────────────────────────────
    console.log('\n── Console errors ──');
    if (!errors.length) {
      console.log('  None 🎉');
    } else {
      errors.forEach(e => console.error(' ', e));
    }

    if (warnings.length) {
      console.log('── Console warnings ──');
      warnings.slice(0, 10).forEach(w => console.warn(' ', w));
    }

    console.log('\nScreenshots saved to /tmp/cerberus-test-*.png');

  } finally {
    await browser.close();
  }
})();
