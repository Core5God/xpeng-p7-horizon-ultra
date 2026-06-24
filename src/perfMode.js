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
  const quality = (qs('quality') || '').toLowerCase();
  // [PERF1b] 统一 ?quality= 入口：ultralite|low|medium|high（low → safe 档）。
  if (quality === 'ultralite' || quality === 'ultra-lite') return { tier: 'ultralite', reason: 'url-quality' };
  if (quality === 'low' || quality === 'safe') return { tier: 'safe', reason: 'url-quality' };
  if (quality === 'medium' || quality === 'mid') return { tier: 'medium', reason: 'url-quality' };
  if (quality === 'high') return { tier: 'high', reason: 'url-quality' };
  if (quality === 'photo' || quality === 'garage') return { tier: 'photo', reason: 'url-quality' };
  // [PERF1] UltraLite：最省档。只保 车/路/极简地形/基础天空/基础驾驶。
  if (qs('ultralite') === '1' || perf === 'ultralite' || perf === 'ultra-lite') return { tier: 'ultralite', reason: 'url-force' };
  if (qs('safe') === '1' || perf === 'low') return { tier: 'safe', reason: 'url-force' };
  if (perf === 'medium' || perf === 'mid') return { tier: 'medium', reason: 'url-force' };
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
  tier: _init.tier,            // 'ultralite' | 'safe' | 'auto' | 'high' | 'photo'
  reason: _init.reason,
  isSafe: _init.tier === 'safe' || _init.tier === 'ultralite',
  isUltraLite: _init.tier === 'ultralite',
  macRetina: detectMacRetina(),
  lowMemory: detectLowMemory(),
  preloadMs: 0,                // assetPreload 计时（由 assetPreload 写回）
  // 运行期状态镜像（供 HUD 读）：
  pixelRatio: 1,
  bloomOn: false,
  reflectionOn: false,
  shadowSize: 0,
  // [PERF1] CPU/GPU 拆分计时（由 main.js loop 写回）：
  updateMs: 0,
  renderMs: 0
};

// [PERF1] 车优先预算表：按档位给出世界/车/HUD/特效预算。
//   原则：车是主角（车漆/车灯/边缘高光/适度反射优先保），环境是陪衬（树/草/远景/粒子大幅降级）。
//   carReflectionMode：'off' 不用实时 CubeCamera、靠静态 envMap；'static' 驾驶中不动、车库/照片拍一次；
//                   'low' 低频；'live' 速度自适应高频。
const _BUDGETS = {
  ultralite: {
    worldQuality: 'off', terrainQuality: 'ultralite',
    targetTrees: 0, targetBushes: 0, palmRock: 0, flowers: 0, reeds: 0, reefs: 0,
    grass: false, roadside: false, terrainSeg: 180,
    carQuality: 'lite', carReflectionMode: 'off',
    bloom: false, shadow: false, character: false, minimap: false, radio: false, complexHud: false,
    effectBudget: 'off', hudBudget: 'lite'
  },
  safe: {
    worldQuality: 'low', terrainQuality: 'safe',
    targetTrees: 220, targetBushes: 120, palmRock: 0, flowers: 0, reeds: 0, reefs: 0,
    grass: false, roadside: false, terrainSeg: 200,
    carQuality: 'high', carReflectionMode: 'lowfreq',
    bloom: false, shadow: true, character: true, minimap: true, radio: true, complexHud: true,
    effectBudget: 'off', hudBudget: 'lite'
  },
  auto: {
    worldQuality: 'mid', terrainQuality: 'high',
    targetTrees: 1400, targetBushes: 900, palmRock: 180, flowers: 360, reeds: 240, reefs: 80,
    grass: true, roadside: true, terrainSeg: 300,
    carQuality: 'high', carReflectionMode: 'low',
    bloom: false, shadow: true, character: true, minimap: true, radio: true, complexHud: true,
    effectBudget: 'mid', hudBudget: 'full'
  },
  // [PERF1b] Medium：普通设备。车/角色/公路完整，中等树木密度（<=50% high），基础反射，少量后处理。
  //   预算：textures<60, geometries<250, tree<=50%(high=3500→50%=1750)。
  medium: {
    worldQuality: 'mid', terrainQuality: 'high',
    targetTrees: 1750, targetBushes: 1100, palmRock: 200, flowers: 400, reeds: 260, reefs: 90,
    grass: true, roadside: true, terrainSeg: 300,
    carQuality: 'high', carReflectionMode: 'low',
    bloom: false, shadow: true, character: true, minimap: true, radio: true, complexHud: true,
    effectBudget: 'mid', hudBudget: 'full'
  },
  high: {
    worldQuality: 'full', terrainQuality: 'high',
    targetTrees: 3500, targetBushes: 2400, palmRock: 400, flowers: 800, reeds: 500, reefs: 120,
    grass: true, roadside: true, terrainSeg: 300,
    carQuality: 'ultra', carReflectionMode: 'live',
    bloom: true, shadow: true, character: true, minimap: true, radio: true, complexHud: true,
    effectBudget: 'full', hudBudget: 'full'
  },
  photo: {
    worldQuality: 'full', terrainQuality: 'high',
    targetTrees: 3500, targetBushes: 2400, palmRock: 400, flowers: 800, reeds: 500, reefs: 120,
    grass: true, roadside: true, terrainSeg: 300,
    carQuality: 'ultra', carReflectionMode: 'live',
    bloom: true, shadow: true, character: true, minimap: true, radio: true, complexHud: true,
    effectBudget: 'full', hudBudget: 'full'
  }
};

// 按当前（或传入）档位返回世界预算。
export function worldBudget(tier) {
  return _BUDGETS[tier || PERF.tier] || _BUDGETS.auto;
}

// [PERF1b] 资源预算上限（textures / geometries / tree / particle）——对应需求文档预算表。
//   仅作为 perfdebug 展示 + 自适应判断参考，不硬性截断已有析构。
const _CAPS = {
  ultralite: { textures: 20, geometries: 80, tree: 0, particle: 0 },
  safe:      { textures: 35, geometries: 150, tree: 350 /*<=10% high(3500)*/, particle: 0 },
  medium:    { textures: 60, geometries: 250, tree: 1750 /*<=50% high*/, particle: 200 },
  auto:      { textures: 60, geometries: 250, tree: 1750, particle: 200 },
  high:      { textures: 120, geometries: 600, tree: 3500, particle: 800 },
  photo:     { textures: 140, geometries: 700, tree: 3500, particle: 1000 }
};
export function budgetCaps(tier) { return _CAPS[tier || PERF.tier] || _CAPS.auto; }

// [PERF1b] 车视觉保护策略：任何档位都不降车漆颜色/车身基础金属质感/公路基础贴图/角色基础可见性。
//   只允许降：反射频率、反射分辨率、阴影分辨率、环境密度。
export const PROTECT = {
  carPaintProtected: true,
  roadTextureProtected: true,
  characterBaselineProtected: true
};

export function isSafeMode() { return PERF.tier === 'safe' || PERF.tier === 'ultralite'; }
export function isUltraLite() { return PERF.tier === 'ultralite'; }

// 像素比上限（按档位）：ultralite/safe=1.0，auto/high=1.25，photo=1.5
export function maxPixelRatioFor(tier) {
  switch (tier || PERF.tier) {
    case 'ultralite': return 1.0;
    case 'safe': return 1.0;
    case 'photo': return 1.5;
    case 'high':
    case 'medium':
    case 'auto':
    default: return 1.25;
  }
}

// 切换档位（运行期降级/升级用）。降到 safe 时写 localStorage 记住。
export function setTier(tier) {
  PERF.tier = tier;
  PERF.isSafe = tier === 'safe' || tier === 'ultralite';
  PERF.isUltraLite = tier === 'ultralite';
  try {
    if (tier === 'safe' || tier === 'ultralite') localStorage.setItem('p7_perf_safe', '1');
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
