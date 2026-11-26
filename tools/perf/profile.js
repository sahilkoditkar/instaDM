// Performance profile of InstaDM's page script (assets/instadm-page.js).
//
// Instagram itself can't be loaded in CI, and its own cost isn't ours to
// change, so this measures what InstaDM ADDS: every scenario runs twice on
// the same Instagram-shaped stress page, once without and once with the
// script, in Chromium (the engine behind Android's WebView) with the CPU
// slowed down to approximate a mid-range phone. The difference is our cost.
//
//   node tools/perf/profile.js [--throttle 4] [--seconds 30]

const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');
const http = require('http');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? Number(args[i + 1]) : def; };
const THROTTLE = opt('throttle', 4);
const CHAT_SECONDS = opt('seconds', 30);
const SCRIPT = fs.readFileSync(path.join(__dirname, '../../app/src/main/assets/instadm-page.js'), 'utf8');

// ---- An Instagram-DM-shaped page: big DOM, live chat, videos, reel viewer ----
function stressPage() {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{margin:0;font-family:sans-serif}
header{position:sticky;top:0;background:#fff;height:56px;display:flex;gap:8px;align-items:center;z-index:2}
#inbox{display:none}
#thread{height:calc(100vh - 110px);overflow-y:auto}
.m{padding:4px 12px}.b{display:inline-block;max-width:70%;padding:8px 12px;border-radius:18px;background:#efefef}
#thread video{width:55vw;height:28vh;background:#333;display:block}
#composer{position:fixed;bottom:0;left:0;right:0;height:54px;background:#fff}
#viewer{position:fixed;inset:0;background:#000;overflow-y:scroll;scroll-snap-type:y mandatory;display:none;z-index:5}
#viewer section{height:100vh;scroll-snap-align:start}#viewer video{width:100vw;height:100vh;display:block}
</style></head><body>
<header><a href="/direct/inbox/" aria-label="Back"><svg width="24" height="24"></svg></a><a href="/direct/t/1/">Alex</a>
<button aria-label="Audio call"><svg width="24" height="24"></svg></button><button aria-label="Conversation information"><svg width="24" height="24"></svg></button></header>
<main><div id="inbox"></div><div id="thread"></div></main>
<div id="composer"><div role="textbox" contenteditable="true" id="box"></div></div>
<div id="viewer"><section><video></video></section><section><video></video></section><section><video></video></section></div>
<script>
var words = 'hey lol ok see you soon did you open the app yesterday that reel was wild haha what time tonight'.split(' ');
function msg(i) {
  var m = document.createElement('div'); m.className = 'm'; m.setAttribute('role', 'row');
  var inner = '<div><div><div class="b"><span dir="auto">';
  for (var w = 0; w < 4 + (i % 9); w++) inner += words[(i * 7 + w) % words.length] + ' ';
  inner += '</span></div></div><div><span>' + (i % 24) + ':0' + (i % 6) + '</span></div></div>';
  if (i % 60 === 7) inner += '<video></video>';
  m.innerHTML = inner; return m;
}
var t = document.getElementById('thread');
for (var i = 0; i < 400; i++) t.appendChild(msg(i));
var inbox = document.getElementById('inbox');
for (var j = 0; j < 150; j++) { var r = document.createElement('div');
  r.innerHTML = '<a href="/direct/t/' + j + '/"><div><img alt=""><div><span>Friend ' + j + '</span><span>Last message ' + j + '</span></div></div></a>';
  inbox.appendChild(r); }
window.__msgCount = 400;
window.__addMessage = function () { t.appendChild(msg(window.__msgCount++)); t.scrollTop = t.scrollHeight; };
window.__type = function () { var b = document.getElementById('box');
  if (b.textContent.length > 60) b.textContent = ''; b.textContent += 'a'; };
window.__longTasks = 0; window.__longTaskMs = 0;
try { new PerformanceObserver(function (l) { l.getEntries().forEach(function (e) {
  window.__longTasks++; window.__longTaskMs += e.duration; }); }).observe({ type: 'longtask', buffered: true }); } catch (e) {}
</script></body></html>`;
}

async function metrics(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  const m = Object.fromEntries(metrics.map(x => [x.name, x.value]));
  return { script: m.ScriptDuration * 1000, task: m.TaskDuration * 1000, heap: m.JSHeapUsedSize / 1048576,
           nodes: m.Nodes, styles: m.RecalcStyleCount, layouts: m.LayoutCount };
}

async function run(withScript, base) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  if (withScript) await ctx.addInitScript({ content: SCRIPT });
  const page = await ctx.newPage();
  const requests = [];
  page.on('request', r => requests.push(r.url()));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  const gcHeap = async () => { await cdp.send('HeapProfiler.collectGarbage'); return (await metrics(cdp)).heap; };
  const swipe = async (y1, y2) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: y1 }] });
    for (let i = 1; i <= 10; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y: y1 + (y2 - y1) * i / 10 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const out = {};
  const phase = async (name, fn) => {
    const a = await metrics(cdp);
    const t0 = Date.now();
    await fn();
    const b = await metrics(cdp);
    out[name] = { scriptMs: b.script - a.script, taskMs: b.task - a.task, styles: b.styles - a.styles,
                  layouts: b.layouts - a.layouts, wallMs: Date.now() - t0 };
  };

  await phase('load', async () => { await page.goto(base + '/direct/t/1/'); await page.waitForTimeout(2000); });
  out.heapAfterLoad = await gcHeap();
  await phase('chat', async () => {
    // Active conversation: a keystroke every 80 ms, a new message every 1.5 s.
    const end = Date.now() + CHAT_SECONDS * 1000;
    let n = 0;
    while (Date.now() < end) {
      await page.evaluate(() => window.__type());
      if (++n % 19 === 0) await page.evaluate(() => window.__addMessage());
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(500);
  });
  out.heapAfterChat = await gcHeap();
  await phase('scroll', async () => { for (let i = 0; i < 20; i++) await swipe(i % 2 ? 250 : 650, i % 2 ? 650 : 250); await page.waitForTimeout(500); });
  await phase('reel', async () => {
    await page.evaluate(() => { document.getElementById('viewer').style.display = 'block'; });
    for (let i = 0; i < 20; i++) await swipe(650, 200);
    await page.evaluate(() => { document.getElementById('viewer').style.display = 'none'; });
    await page.waitForTimeout(500);
  });
  out.heapEnd = await gcHeap();
  out.nodes = (await metrics(cdp)).nodes;
  out.longTasks = await page.evaluate(() => [window.__longTasks, window.__longTaskMs]);
  out.stats = await page.evaluate(() => window.__instadm || null);
  out.requests = requests;
  await browser.close();
  return out;
}

(async () => {
  const html = stressPage();
  const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(html); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  console.log(`InstaDM page-script profile: CPU throttled ${THROTTLE}x, ${CHAT_SECONDS}s of active chat\n`);
  const without = await run(false, base);
  const withS = await run(true, base);

  const f = n => n.toFixed(1).padStart(8);
  console.log('CPU time (main-thread task ms)      without     with    added');
  for (const p of ['load', 'chat', 'scroll', 'reel']) {
    console.log(`  ${p.padEnd(32)}${f(without[p].taskMs)} ${f(withS[p].taskMs)} ${f(withS[p].taskMs - without[p].taskMs)}`);
  }
  console.log('JS time only (script ms)');
  for (const p of ['load', 'chat', 'scroll', 'reel']) {
    console.log(`  ${p.padEnd(32)}${f(without[p].scriptMs)} ${f(withS[p].scriptMs)} ${f(withS[p].scriptMs - without[p].scriptMs)}`);
  }
  console.log('Style recalcs during chat           ' + `${f(without.chat.styles)} ${f(withS.chat.styles)}`);
  console.log('JS heap after GC (MB)');
  for (const k of ['heapAfterLoad', 'heapAfterChat', 'heapEnd']) {
    console.log(`  ${k.padEnd(32)}${f(without[k])} ${f(withS[k])} ${f(withS[k] - without[k])}`);
  }
  console.log(`DOM nodes at end                    ${f(without.nodes)} ${f(withS.nodes)}`);
  console.log(`Long tasks (>50ms): count / total ms   without ${without.longTasks[0]} / ${without.longTasks[1].toFixed(0)}   with ${withS.longTasks[0]} / ${withS.longTasks[1].toFixed(0)}`);
  const s = withS.stats;
  console.log(`Script scans: ${s.scans}, total ${s.scanMs.toFixed(1)} ms, avg ${(s.scanMs / Math.max(1, s.scans)).toFixed(2)} ms, worst ${s.maxScanMs.toFixed(2)} ms (unthrottled clock inside throttled CPU)`);
  console.log(`Reel swipes blocked: ${s.reelSwipesBlocked || 0}`);
  const extra = withS.requests.filter(u => !without.requests.includes(u));
  console.log(`Network requests: without ${without.requests.length}, with ${withS.requests.length}, made by the script: ${extra.length}${extra.length ? ' ' + extra.join(', ') : ''}`);
  server.close();
})();
