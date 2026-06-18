// ---------- 首访关键资源预热 ----------
// 目标：在允许进入游戏前，先把首屏必需的 GLB / HDR / PBR 贴图 / 树木数据拉进 HTTP 缓存。
// Three.js 的 TextureLoader / GLTFLoader 仍负责真正创建 GPU 资源，但冷启动时不会再边进游戏边抢下载。

const CRITICAL_ASSETS = [
  // 车辆 / 角色
  { url: 'assets/e29.glb', type: 'buffer' },
  { url: 'assets/character.glb', type: 'buffer' },
  { url: 'assets/iron.glb', type: 'buffer' },

  // 动态天空首轮关键帧
  { url: 'assets/sky/day3.hdr', type: 'buffer' },
  { url: 'assets/sky/day2.hdr', type: 'buffer' },
  { url: 'assets/sky/evening.hdr', type: 'buffer' },
  { url: 'assets/sky/night2.hdr', type: 'buffer' },
  { url: 'assets/sky/night1.hdr', type: 'buffer' },

  // 地形 / 道路 PBR 贴图
  { url: 'assets/terrain/sand_diff.jpg', type: 'image' },
  { url: 'assets/terrain/forest_diff.jpg', type: 'image' },
  { url: 'assets/terrain/rock_diff.jpg', type: 'image' },
  { url: 'assets/terrain/dry_diff.jpg', type: 'image' },
  { url: 'assets/terrain/sand_rough.webp', type: 'image' },
  { url: 'assets/terrain/forest_rough.webp', type: 'image' },
  { url: 'assets/terrain/rock_rough.webp', type: 'image' },
  { url: 'assets/terrain/dry_rough.webp', type: 'image' },
  { url: 'assets/terrain/forest_nrm.webp', type: 'image' },
  { url: 'assets/terrain/road2_diff.jpg', type: 'image' },
  { url: 'assets/terrain/road2_nrm.webp', type: 'image' },
  { url: 'assets/terrain/road2_rough.webp', type: 'image' },

  // 森林烘焙数据与基础贴图
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

  if (failures.length) {
    const list = failures.map(f => f.asset.url).join(', ');
    throw new Error('关键资源预热失败：' + list);
  }
}
