// Checks the reel-viewer lock and the route fade with real touch swipes.
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');
const http = require('http');
(async () => {
  // Serve the mock page over http so history.pushState can change the path.
  const html = fs.readFileSync(path.join(__dirname, 'reel-fixture.html'));
  const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(html); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const script = fs.readFileSync(path.join(__dirname, '../../app/src/main/assets/instadm-page.js'), 'utf8');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  await ctx.addInitScript({ content: script });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base + '/direct/inbox/');
  await page.waitForTimeout(500); // let layout settle before the first gesture
  const cdp = await ctx.newCDPSession(page);
  const swipe = async (x, y1, y2, xEnd = x) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y1 }] });
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove',
        touchPoints: [{ x: x + (xEnd - x) * i / steps, y: y1 + (y2 - y1) * i / steps }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(600);
  };
  const top = sel => page.evaluate(s => document.querySelector(s).scrollTop, sel);
  let fail = 0;
  const check = (name, ok, detail) => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };

  // 1. Normal chat (with a small inline video) still scrolls.
  await swipe(200, 600, 200);
  const t1 = await top('#thread');
  check('chat scrolls', t1 > 100, `thread scrollTop=${t1}`);

  // 2. Reel viewer open: swipe up must not move to the next reel.
  await page.evaluate(() => { document.getElementById('viewer').style.display = 'block'; });
  await page.waitForTimeout(100);
  await swipe(200, 600, 150);
  await swipe(200, 650, 100);
  const v = await top('#viewer');
  check('reel viewer does not scroll', v <= 1, `viewer scrollTop=${v}`);
  const js = await page.evaluate(() => window.jsSwipes);
  check("Instagram's swipe code never sees the swipe", js === 0, `jsSwipes=${js}`);

  // 3. Scripted scroll inside the viewer is put back.
  await swipe(200, 400, 400); // a tap-like touch starts the lock
  await page.evaluate(() => { document.getElementById('viewer').scrollTop = 900; });
  await page.waitForTimeout(200);
  const v2 = await top('#viewer');
  check('scripted scroll is undone', v2 <= 1, `viewer scrollTop=${v2}`);

  // 4. Viewer closed: chat scrolls again.
  await page.evaluate(() => { document.getElementById('viewer').style.display = 'none'; });
  const before = await top('#thread');
  await swipe(200, 200, 600);
  const after = await top('#thread');
  check('chat scrolls again after closing', after < before, `thread scrollTop ${before} -> ${after}`);

  // 5. Route change fades the main area.
  const faded = await page.evaluate(() => new Promise(res => {
    history.pushState({}, '', '/direct/t/123/');
    setTimeout(() => res(document.getElementById('main').classList.contains('instadm-route-in')), 80);
  }));
  check('route change fades in', faded, '');

  console.log('stats', JSON.stringify(await page.evaluate(() => window.__instadm)));
  check('no page errors', errors.length === 0, errors.join('; '));
  console.log(fail ? `${fail} FAILED` : 'ALL PASS');
  process.exitCode = fail ? 1 : 0;
  await browser.close();
  server.close();
})();
