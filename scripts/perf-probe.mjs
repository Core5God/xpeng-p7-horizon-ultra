// ---------- Headless per-tier perf probe (VPS software rendering) ----------
// [PERF1b] 在无 GPU 的 VPS 上用 SwiftShader 软渲跑各画质档位，读真实
//   FPS / updateMs / renderMs / frameMs / drawcalls / triangles / geometries / textures。
//   注意：SwiftShader 软渲数据 != 真机，仅供相对对比 + 验证读数链路。
// 用法：
//   node scripts/perf-probe.mjs                       # 默认跑 ultralite,low,medium,high
//   node scripts/perf-probe.mjs ultralite low medium high
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary',
  '.hdr': 'image/vnd.radiance', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.ktx2': 'image/ktx2', '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
};
function startStatic(rootDir) {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        let urlPath = decodeURIComponent(req.url.split('?')[0]);
        if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
        const fp = path.join(rootDir, urlPath);
        if (!fp.startsWith(rootDir)) { res.writeHead(403); res.end(); return; }
        const st = await stat(fp).catch(() => null);
        if (!st || !st.isFile()) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size });
        createReadStream(fp).pipe(res);
      } catch (e) { res.writeHead(500); res.end(String(e)); }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const BOOT_TIMEOUT_MS = 180000;

async function main() {
  const tiers = process.argv.slice(2).filter(Boolean);
  const TIERS = tiers.length ? tiers : ['ultralite', 'low', 'medium', 'high'];

  const { chromium } = await import('playwright');
  const rootDir = path.resolve(REPO, 'dist');
  const server = await startStatic(rootDir);
  const base = `http://127.0.0.1:${server.address().port}`;
  console.log('[probe] static', base);

  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage'],
  });

  const rows = [];
  try {
    for (const tier of TIERS) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
      page.setDefaultTimeout(BOOT_TIMEOUT_MS);
      page.setDefaultNavigationTimeout(BOOT_TIMEOUT_MS);
      const errs = [];
      page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
      page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });

      const url = `${base}/?quality=${tier}&perfdebug=1`;
      console.log('[probe] tier=', tier, url);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(
        () => typeof window.__perfProbe === 'function' && !document.getElementById('boot'),
        { timeout: BOOT_TIMEOUT_MS },
      );
      // 进入驾驶态，让世界/反射/HUD 跑起来
      await page.evaluate(() => { try { window.__perfStartDrive && window.__perfStartDrive(); } catch (e) {} });
      // 跑 6 秒（过 warmup + 一个反射低频周期），同时用 rAF 采样 FPS
      const fps = await page.evaluate(() => new Promise((resolve) => {
        let frames = 0; const t0 = performance.now();
        function tick() { frames++; if (performance.now() - t0 < 6000) requestAnimationFrame(tick); else resolve(Math.round(frames * 1000 / (performance.now() - t0))); }
        requestAnimationFrame(tick);
      }));
      const probe = await page.evaluate(() => window.__perfProbe());
      const frameMs = +(probe.perf.updateMs + probe.perf.renderMs).toFixed(2);
      rows.push({ tier, fps, frameMs, ...probe });
      console.log(`  tier=${probe.tier} fps=${fps} update=${probe.perf.updateMs} render=${probe.perf.renderMs} frame=${frameMs} calls=${probe.info.calls} tris=${probe.info.triangles} geo=${probe.info.geometries} tex=${probe.info.textures}${errs.length ? ' ERR:' + errs.length : ''}`);
      if (errs.length) console.log('   errs:', errs.slice(0, 3));
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n[probe] ===== 各档真实读数（VPS SwiftShader 软渲，非真机）=====');
  console.log('tier        fps  frameMs  update  render  calls   tris      geo   tex   reflMode');
  for (const r of rows) {
    const reflMode = (r.budget.carReflectionMode || '?') + (r.perf.reflectionLive ? '·live' : '');
    console.log(
      `${(r.tier + '          ').slice(0, 11)} ${String(r.fps).padStart(3)}  ${String(r.frameMs).padStart(6)}  ${String(r.perf.updateMs).padStart(6)}  ${String(r.perf.renderMs).padStart(6)}  ${String(r.info.calls).padStart(5)}  ${String(r.info.triangles).padStart(8)}  ${String(r.info.geometries).padStart(4)}  ${String(r.info.textures).padStart(4)}  ${reflMode}`
    );
  }
  process.exit(0);
}

main().catch((e) => { console.error('[probe] 失败:', e); process.exit(1); });
