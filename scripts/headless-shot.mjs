// ---------- Headless WebGL screenshot tool (VPS software rendering) ----------
// task-20260620-015 / 让 Leader 在无 GPU 的 VPS 上对 Three.js demo 做无头截图自检。
//
// 渲染路径：Playwright + headless Chromium + SwiftShader（软件 WebGL2）。
//   实测后端：ANGLE (Vulkan SwiftShader)，WebGL 2.0 可用，无需 GPU。
//
// 依赖（已装在本仓库 devDependencies / playwright 缓存）：
//   npm i -D playwright && npx playwright install chromium
//   系统：libgl1-mesa-dri / xvfb 已预装（SwiftShader 实际不依赖 xvfb，纯 headless 即可）。
//
// 用法：
//   node scripts/headless-shot.mjs                 # 默认起 dist 静态服务，截 vp=2,3
//   node scripts/headless-shot.mjs 2 3 5           # 指定机位列表
//   node scripts/headless-shot.mjs --vp 2,3 --out .shots --fmt jpg --w 1600 --h 900
//   node scripts/headless-shot.mjs --url http://localhost:4173  # 用已有的外部服务
//
// 输出：默认 <repo>/.shots/vpNN_<name>.<fmt>
//
// 原理：起静态服务托管 dist/ → headless 打开 /?fastdebug=1&vp=N →
//   等 boot 元素移除 + window.__jumpToViewpoint 就绪 → 跳机位 → 等渲染稳定 → 截图。

import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

// ---------- 参数解析 ----------
function parseArgs(argv) {
  const o = { vps: [], out: null, fmt: 'jpg', w: 1600, h: 900, url: null, root: 'dist', quality: 80, settle: 3500 };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--vp') o.vps.push(...argv[++i].split(',').map(s => s.trim()).filter(Boolean));
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--fmt') o.fmt = argv[++i];
    else if (a === '--w') o.w = +argv[++i];
    else if (a === '--h') o.h = +argv[++i];
    else if (a === '--url') o.url = argv[++i];
    else if (a === '--root') o.root = argv[++i];
    else if (a === '--quality') o.quality = +argv[++i];
    else if (a === '--settle') o.settle = +argv[++i];
    else if (/^\d+$/.test(a)) rest.push(a);
    else console.warn('[shot] 忽略未知参数', a);
  }
  if (rest.length) o.vps.push(...rest);
  if (!o.vps.length) o.vps = ['2', '3'];
  if (!o.out) o.out = path.join(REPO, '.shots');
  return o;
}

// ---------- 极简静态文件服务（仅本任务，跑完即关）----------
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

const VIEWPORT_W = (o) => o.w, VIEWPORT_H = (o) => o.h;
// SwiftShader 软渲下，fastdebug 仍要跑完地形/森林/角色 GLB 等建场阶段，
// 单是 buildScenery 就 ~30s，整个 boot 可能 60~120s。超时给足。
const BOOT_TIMEOUT_MS = 180000;

async function main() {
  const o = parseArgs(process.argv.slice(2));
  await mkdir(o.out, { recursive: true });

  const { chromium } = await import('playwright');

  let server = null, base = o.url;
  if (!base) {
    const rootDir = path.resolve(REPO, o.root);
    server = await startStatic(rootDir);
    base = `http://127.0.0.1:${server.address().port}`;
    console.log('[shot] 本地静态服务', base, '→', rootDir);
  } else {
    console.log('[shot] 使用外部服务', base);
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage'],
  });

  const results = [];
  try {
    for (const vp of o.vps) {
      const page = await browser.newPage({ viewport: { width: o.w, height: o.h }, deviceScaleFactor: 1 });
      page.setDefaultTimeout(BOOT_TIMEOUT_MS);
      page.setDefaultNavigationTimeout(BOOT_TIMEOUT_MS);
      const errs = [];
      page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
      page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
      // 软渲下 boot 较慢，转发阶段进度便于观察
      page.on('console', (m) => {
        const t = m.text();
        if (/FASTDEBUG|FOREST|SKY|viewpoint|生成|建场|boot/i.test(t)) console.log('    [page]', t.slice(0, 100));
      });

      const url = `${base}/?fastdebug=1&vp=${vp}`;
      const t0 = Date.now();
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      // 等 boot 完成 + 跳转钩子就绪
      await page.waitForFunction(
        () => typeof window.__jumpToViewpoint === 'function' && !document.getElementById('boot'),
        { timeout: BOOT_TIMEOUT_MS },
      );
      // 再显式跳一次（URL 自动跳转可能因竞态丢失），确保机位准确
      await page.evaluate((id) => { try { window.__jumpToViewpoint(String(id)); } catch (e) {} }, vp);
      await page.waitForTimeout(o.settle);

      // 取机位名
      let vpName = `vp${String(vp).padStart(2, '0')}`;
      try {
        const meta = await page.evaluate((id) => {
          const arr = window.__VIEWPOINTS || [];
          const v = arr.find((x) => String(x.id) === String(id));
          return v ? { name: v.name, label: v.label } : null;
        }, vp);
        if (meta && meta.name) vpName = meta.name.replace(/\.(png|jpg|jpeg)$/i, '');
      } catch (e) {}

      const ext = o.fmt === 'png' ? 'png' : 'jpg';
      const out = path.join(o.out, `${vpName}.${ext}`);
      // 用 CDP Page.captureScreenshot 直接抓帧，避开 Playwright 对持续 rAF 动画的
      // "稳定"等待（WebGL loop 永不静止会导致 page.screenshot 超时）。
      const cdp = await page.context().newCDPSession(page);
      const cap = await cdp.send('Page.captureScreenshot',
        ext === 'jpg' ? { format: 'jpeg', quality: o.quality } : { format: 'png' });
      const { writeFile } = await import('node:fs/promises');
      await writeFile(out, Buffer.from(cap.data, 'base64'));
      await cdp.detach().catch(() => {});

      const ms = Date.now() - t0;
      // 黑屏检测：抓 canvas 中心一小块像素方差
      const probe = await page.evaluate(() => {
        const c = document.querySelector('canvas');
        if (!c) return { hasCanvas: false };
        try {
          const g = c.getContext('webgl2') || c.getContext('webgl');
          return { hasCanvas: true, ctx: !!g, w: c.width, h: c.height };
        } catch (e) { return { hasCanvas: true, ctx: false }; }
      });
      results.push({ vp, out, ms, errs: errs.slice(0, 3), probe });
      console.log(`[shot] vp=${vp} → ${out}  (${ms}ms)${errs.length ? '  ⚠ console errors: ' + errs.length : ''}`);
      await page.close();
    }
  } finally {
    await browser.close();
    if (server) server.close();
  }

  console.log('\n[shot] 完成。结果：');
  for (const r of results) console.log('  -', r.vp, r.out, r.ms + 'ms', JSON.stringify(r.probe), r.errs.length ? ' err:' + JSON.stringify(r.errs) : '');
  // SwiftShader chromium 关闭偏慢，结果已落盘，直接退出避免挂死。
  process.exit(0);
}

main().catch((e) => { console.error('[shot] 失败:', e); process.exit(1); });
