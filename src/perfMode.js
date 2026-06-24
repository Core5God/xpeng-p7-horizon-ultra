// ---------- V2-PERF0：Mac Safe Boot + Render Cost Kill Switch ----------
// 单一来源的性能档位 / Safe Mode 判定。core.js / main.js / world.js / vehicle.js /
// skycycle.js / ui.js / assetPreload.js 全部从这里读取，避免各文件各判各的。
//
// 档位（quality tier）：
//   'safe'  —— Mac/Retina / 低内存 / ?safe / ?perf=low 默认。最省：pixelRatio=1、
//              关 selective bloom、关 GTAO、CubeCamera 驾驶中不更新、shadowMap 1024、
//              地形低成本分支、首屏只加载 e29.glb + 最小地形贴图。
//   'auto'  —— 普通桌面首访默认。pixelRatio 1.0 起步，稳定后最多 1.25；bloom 默认关
//              （夜间/照片再开），CubeCamera 最低 2 秒一次。
//   'high'  —— 手动升级。pixelRatio 最多 1.25，bloom 常开，CubeCamera 较快。
//   'photo' —— 照片模式临时高画质，pixelRatio 最多 1.5。
//
// URL：?safe=1 或 ?perf=low 强制 safe；?perf=high 强制 high；?perfdebug=1 显示 HUD。

function qs(name) {
  try { return new URLSearchParams(location.search).get(name); }
  catch { return null; }
}

export const PERF_DEBUG = qs('perfdebug') === '1';

// ---------- Mac / Retina / 低端判定 ----------
function detectMacRetina() {
  try {
    const ua = navigator.userAgent || '';
    const plat = navigator.platform || '';
    const isMac = /Mac/i.test(plat) || (/Mac OS X|Macintosh/i.test(ua) && !/iPhone|iPad|iPod/i.test(ua));
    const dpr = window.devicePixelRatio || 1;
    return isMac && dpr > 1; // Retina Mac：高 DPR + Mac → 默认 Safe（救火重点机型）
  } catch { return false; }
}

function detectLowMemory() {
  try {
    const dm = navigator.deviceMemory;
    return typeof dm === 'number' && dm > 0 && dm <= 4;
  } catch { return false; }
}

// ---------- 决定初始档位 ----------
function resolveInitialTier() {
  const perf = (qs('perf') || '').toLowerCase();
  if (qs('safe') === '1' || perf === 'low') return { tier: 'safe', reason: 'url-force' };
  if (perf === 'high') return { tier: 'high', reason: 'url-force' };
  if (perf === 'auto') return { tier: 'auto', reason: 'url-force' };

  // localStorage 记住低画质：上次被降到 safe 就继续 safe
  try {
    if (localStorage.getItem('p7_perf_safe') === '1') return { tier: 'safe', reason: 'localstorage' };
  } catch {}

  if (detectMacRetina()) return { tier: 'safe', reason: 'mac-retina' };
  if (detectLowMemory()) return { tier: 'safe', reason: 'low-memory' };

  return { tier: 'auto', reason: 'default-auto' }; // 普通桌面首访：Auto，不再默认最高
}

const _init = resolveInitialTier();

export const PERF = {
  tier: _init.tier,            // 'safe' | 'auto' | 'high' | 'photo'
  reason: _init.reason,
  isSafe: _init.tier === 'safe',
  macRetina: detectMacRetina(),
  lowMemory: detectLowMemory(),
  preloadMs: 0,                // assetPreload 计时（由 assetPreload 写回）
  // 运行期状态镜像（供 HUD 读）：
  pixelRatio: 1,
  bloomOn: false,
  reflectionOn: false,
  shadowSize: 0
};

export function isSafeMode() { return PERF.tier === 'safe'; }

// 像素比上限（按档位）：safe=1.0，auto/high=1.25，photo=1.5
export function maxPixelRatioFor(tier) {
  switch (tier || PERF.tier) {
    case 'safe': return 1.0;
    case 'photo': return 1.5;
    case 'high':
    case 'auto':
    default: return 1.25;
  }
}

// 切换档位（运行期降级/升级用）。降到 safe 时写 localStorage 记住。
export function setTier(tier) {
  PERF.tier = tier;
  PERF.isSafe = tier === 'safe';
  try {
    if (tier === 'safe') localStorage.setItem('p7_perf_safe', '1');
    else localStorage.removeItem('p7_perf_safe');
  } catch {}
}

export function rememberSafe(on) {
  try {
    if (on) localStorage.setItem('p7_perf_safe', '1');
    else localStorage.removeItem('p7_perf_safe');
  } catch {}
}

if (typeof console !== 'undefined') {
  console.log('[PERF] initial tier =', PERF.tier, '(', _init.reason, ') macRetina=', PERF.macRetina, 'lowMem=', PERF.lowMemory, 'perfdebug=', PERF_DEBUG);
}
