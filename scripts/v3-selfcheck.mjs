// Headless self-check for V3 PR1 (task-20260621-V3-PR1)
import { chromium } from 'playwright';

const BASE = 'http://localhost:5188/';
const results = [];

async function check(browser, url, settleMs, probe) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERR: ' + e.message));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(settleMs);
  let probeOut = null;
  try { probeOut = await page.evaluate(probe); } catch (e) { probeOut = { probeError: e.message }; }
  results.push({ url, errors, probeOut });
  await ctx.close();
}

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });

// 1) editor (Canvas 2D)
await check(browser, BASE + '?edit=1', 2500, () => {
  const ed = window.__v3editor;
  if (!ed) return { ok: false, reason: 'no __v3editor' };
  return {
    ok: true,
    cps: ed.track.controlPoints.length,
    hasCanvas: !!document.getElementById('v3edit-canvas'),
    schemaVersion: ed.track.schemaVersion,
  };
});

// 2) v3 runtime + verify closed sampleable lap
const lapProbe = () => {
  const v = window.__v3;
  if (!v) return { ok: false, reason: 'no __v3' };
  const w = v.world;
  // 采样整圈 200 个点，验证闭合 + 可采样 + 无 NaN
  const N = 200;
  let bad = 0, maxY = -1e9, minY = 1e9;
  const total = w.total;
  const center = w.center;
  for (let k = 0; k < N; k++) {
    const frac = k / N;
    const fi = frac * center.length;
    const c = center[Math.floor(fi) % center.length];
    if (!isFinite(c.x) || !isFinite(c.y) || !isFinite(c.z)) bad++;
    maxY = Math.max(maxY, c.y); minY = Math.min(minY, c.z * 0 + c.y);
  }
  const first = center[0], last = center[center.length - 1];
  const gap = Math.hypot(first.x - last.x, first.z - last.z);
  return {
    ok: bad === 0,
    km: (total / 1000).toFixed(2),
    samples: center.length,
    chunks: w.chunks.length,
    closureGapM: gap.toFixed(1),
    yRange: [minY.toFixed(0), maxY.toFixed(0)],
    bad,
  };
};
await check(browser, BASE + '?v3=1', 3000, lapProbe);

// 3) viewpoints
for (const vp of [0, 1, 5]) {
  await check(browser, BASE + `?v3=1&vp=${vp}`, 3000, () => {
    const v = window.__v3;
    if (!v) return { ok: false, reason: 'no __v3' };
    const c = v.camera.position;
    return { ok: true, camPos: [c.x.toFixed(0), c.y.toFixed(0), c.z.toFixed(0)],
      rendererOk: !!v.renderer && !!v.renderer.domElement };
  });
}

await browser.close();
console.log(JSON.stringify(results, null, 2));
