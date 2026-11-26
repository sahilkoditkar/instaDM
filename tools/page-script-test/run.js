const { chromium, devices } = require('playwright');
const fs = require('fs');
(async () => {
  const path = require("path");
  const fixture = path.join(__dirname, "fixture.html");
  const script = path.join(__dirname, "../../app/src/main/assets/instadm-page.js");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  await ctx.addInitScript({ content: fs.readFileSync(script, 'utf8') }); // like document-start
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('file://' + fixture);
  await page.waitForTimeout(2000);
  const vis = id => page.evaluate(i => { const e = document.getElementById(i); if (!e) return 'removed'; return e.offsetParent !== null || getComputedStyle(e).position === 'fixed' && getComputedStyle(e).display !== 'none' && !e.closest('[data-instadm-hidden]') ? 'visible' : 'hidden'; }, id);
  const expect = {
    c1: 'hidden', c3: 'visible', c3back: 'visible', c3name: 'visible', c3info: 'visible', c3open: 'hidden',
    navhome: 'hidden', navreels: 'hidden', navexplore: 'hidden', navdm: 'visible',
    c4: 'visible', c7: 'visible', c7msg: 'visible', c7box: 'visible', c8: 'visible', c9: 'visible',
    c6: 'removed', c10: 'hidden',
  };
  let fail = 0;
  for (const [id, want] of Object.entries(expect)) {
    const got = await vis(id);
    const ok = got === want; if (!ok) fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${id}: want ${want}, got ${got}`);
  }
  console.log('dismissClicks', await page.evaluate(() => window.dismissClicks), 'stats', JSON.stringify(await page.evaluate(() => window.__instadm)));
  console.log('page errors', errors.length ? errors : 'none');
  console.log(fail ? `${fail} FAILED` : 'ALL PASS');
  process.exitCode = fail || errors.length ? 1 : 0;
  await browser.close();
})();
