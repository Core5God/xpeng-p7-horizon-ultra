// ---------- 视觉验收点批量截图工具（骨架）----------
// task-20260620-003 / Horizon V2 Visual Baseline Sprint 阶段2
//
// ⚠️ 运行环境要求：本脚本用 Playwright 驱动真实浏览器渲染 WebGL（Three.js）。
//   当前 VPS 沙箱「无 GPU、无 Chromium」，无法 headless 渲染 WebGL，此脚本
//   仅作为骨架提交，需在「有 GPU 的本地/服务器浏览器环境」运行。
//
// 依赖（本仓库当前未安装，运行前需先装）：
//   npm i -D playwright && npx playwright install chromium
//
// 运行步骤：
//   1) 先起本地预览：  npm run build && npm run preview   （默认 http://localhost:4173）
//      或开发模式：     npm run dev                        （默认 http://localhost:5173）
//   2) 另开终端运行：  node scripts/capture-viewpoints.mjs http://localhost:4173
//   3) 截图输出到：    screenshots/vp01_garage.png ... vp08_worst.png
//
// 原理：页面 boot 完成后，window.__jumpToViewpoint(id) 会把相机/车/TOD 摆到
//   第 N 个验收点（见 src/main.js installViewpointJump / src/viewpoints.js）。
//   本脚本遍历 1~8，逐点跳转 → 等待若干帧稳定 → 截图。

import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BASE_URL = process.argv[2] || 'http://localhost:4173';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', 'screenshots');

// 视口分辨率（固定，保证前后对比一致）
const VIEWPORT = { width: 1920, height: 1080 };
// 跳转后等待稳定的毫秒数（含 HDRI/天气/反射重建 + 若干帧）
const SETTLE_MS = 2500;
// boot 完成判定的最长等待
const BOOT_TIMEOUT_MS = 60000;

async function main() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (e) {
    console.error('[capture] 未安装 playwright。请先：npm i -D playwright && npx playwright install chromium');
    console.error('[capture] 当前沙箱无 GPU 无法渲染 WebGL —— 请在有 GPU 的本地/服务器浏览器环境运行本脚本。');
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    // 软件渲染兜底（无 GPU 时画面可能为黑屏，结果仅供占位，真实验收需 GPU）
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error') console.log('[page error]', m.text()); });

  console.log('[capture] 打开', BASE_URL);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  // 等 boot 元素移除 + 跳转钩子就绪
  await page.waitForFunction(
    () => typeof window.__jumpToViewpoint === 'function' && !document.getElementById('boot'),
    { timeout: BOOT_TIMEOUT_MS },
  );
  console.log('[capture] boot 完成，开始遍历验收点');

  const viewpoints = await page.evaluate(() => window.__VIEWPOINTS.map((v) => ({ id: v.id, name: v.name })));

  for (const vp of viewpoints) {
    await page.evaluate((id) => window.__jumpToViewpoint(id), vp.id);
    await page.waitForTimeout(SETTLE_MS);
    const out = path.join(OUT_DIR, vp.name);
    await page.screenshot({ path: out });
    console.log('[capture] 已截图', vp.name);
  }

  await browser.close();
  console.log('[capture] 全部完成 →', OUT_DIR);
}

main().catch((e) => { console.error('[capture] 失败:', e); process.exit(1); });
