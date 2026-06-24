// ---------- 首访关键资源预热（两级化）----------
import { PERF } from './perfMode.js';
// [PERF0] Boot Critical 只保留首屏必需：e29.glb + 最小地形/道路贴图。
// 原本 31 项全塞首屏（含 character/iron/5 HDR/全套地形 PBR/trees+6 树贴图），Mac 冷启动被拖死。
// 原则：页面先打开、车先出现、路先能开。其余资源进游戏后 lazy 预热。
const CRITICAL_ASSETS = [
  // 车辆（唯一必要 GLB）
  { url: 'assets/e29.glb', type: 'buffer' },

  // 首轮当前 TOD 天空（只保留 1 个，默认 sunset → evening）
  { url: 'assets/sky/evening.hdr', type: 'buffer' },

  // 最小地形/道路必要贴图：forest diff（地形底色）+ road2 三贴图（路面）
  { url: 'assets/terrain/forest_diff.jpg', type: 'image' },
  { url: 'assets/terrain/road2_diff.jpg', type: 'image' },
  { url: 'assets/terrain/road2_nrm.webp', type: 'image' },
  { url: 'assets/terrain/road2_rough.webp', type: 'image' }
];

// [PERF0] Lazy 资源：进游戏后后台预热。character/iron/多 HDR/地形多套 PBR/树木。
// 不阻塞首屏；失败只警告不抛。
const LAZY_ASSETS = [
  { url: 'assets/character.glb', type: 'buffer' },
  { url: 'assets/iron.glb', type: 'buffer' },
  { url: 'assets/sky/day3.hdr', type: 'buffer' },
  { url: 'assets/sky/day2.hdr', type: 'buffer' },
  { url: 'assets/sky/night2.hdr', type: 'buffer' },
  { url: 'assets/sky/night1.hdr', type: 'buffer' },
  { url: 'assets/terrain/sand_diff.jpg', type: 'image' },
  { url: 'assets/terrain/rock_diff.jpg', type: 'image' },
  { url: 'assets/terrain/dry_diff.jpg', type: 'image' },
  { url: 'assets/terrain/sand_rough.webp', type: 'image' },
  { url: 'assets/terrain/forest_rough.webp', type: 'image' },
  { url: 'assets/terrain/rock_rough.webp', type: 'image' },
  { url: 'assets/terrain/dry_rough.webp', type: 'image' },
  { url: 'assets/terrain/forest_nrm.webp', type: 'image' },
  { url: 'assets/terrain/road2_diff.jpg', type: 'image' },
  { url: 'assets/trees/trees.json', type: 'json' },
  { url: 'assets/trees/trees.bin', type: 'buffer' },
  { url: 'assets/trees/oak_color.png', type: 'image' },
  { url: 'assets/trees/ash_color.png', type: 'image' },
  { url: 'assets/trees/aspen_color.png', type: 'image' },
  { url: 'assets/trees/pine_color.png', type: 'image' },
  { url: 'assets/trees/oak_color_1k.jpg', type: 'image' },
  { url: 'assets/trees/pine_color_1k.jpg', type: 'image' }
];

function toAbs(url) {
  return new URL(url, document.baseURI).toString();
}

async function loadOne(asset) {
  const abs = toAbs(asset.url);
  const res = await fetch(abs, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${asset.url}`);

  if (asset.type === 'json') {
    await res.json();
    return;
  }

  if (asset.type === 'image') {
    const blob = await res.blob();
    // 提前解码一次，降低 TextureLoader 首次上传纹理时的冷启动抖动。
    if ('createImageBitmap' in window) {
      try {
        const bitmap = await createImageBitmap(blob);
        if (bitmap && typeof bitmap.close === 'function') bitmap.close();
      } catch (err) {
        // 某些 Safari / WebView 对部分 webp 解码策略保守；Blob 已进缓存即可，不阻塞。
        console.warn('[preload] image decode skipped:', asset.url, err);
      }
    }
    return;
  }

  await res.arrayBuffer();
}

export async function preloadCriticalAssets(onProgress) {
  const t0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  const total = CRITICAL_ASSETS.length;
  let done = 0;
  const failures = [];
  const queue = CRITICAL_ASSETS.slice();
  const concurrency = 4;

  async function worker() {
    while (queue.length) {
      const asset = queue.shift();
      try {
        await loadOne(asset);
      } catch (err) {
        failures.push({ asset, err });
        console.error('[preload] failed:', asset.url, err);
      } finally {
        done++;
        if (onProgress) onProgress(done, total, asset.url);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));

  // [PERF0] 记录预热耗时，供 perfdebug HUD 显示。
  const t1 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  PERF.preloadMs = Math.round(t1 - t0);
  console.log('[PERF0] critical preload', PERF.preloadMs, 'ms,', total, 'assets');

  if (failures.length) {
    const list = failures.map(f => f.asset.url).join(', ');
    throw new Error('关键资源预热失败：' + list);
  }
}

// [PERF0] Lazy 预热：进游戏后后台拉取 LAZY_ASSETS。不阻塞、失败只警告。
export async function preloadLazyAssets() {
  const queue = LAZY_ASSETS.slice();
  const concurrency = 2; // 低并发，不抢运行期带宽
  async function worker() {
    while (queue.length) {
      const asset = queue.shift();
      try { await loadOne(asset); }
      catch (err) { console.warn('[preload-lazy] skipped:', asset.url, err); }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  console.log('[PERF0] lazy preload done,', LAZY_ASSETS.length, 'assets');
}
