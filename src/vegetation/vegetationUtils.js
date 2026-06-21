// ---------- 植被系统工具函数 ----------

export function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function randomRange(min, max) { return min + Math.random() * (max - min); }

// ---------- 确定性 seeded RNG（mulberry32）----------
// 用于路边散布：保证每次刷新稳定、不随机漂移。
// 用法：const rng = makeRng(0xC0FFEE); rng() -> [0,1)
export function makeRng(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return function rng() {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// seeded 区间随机：用传入 rng 取 [min,max)
export function rngRange(rng, min, max) { return min + rng() * (max - min); }

// 确定性 2D hash → [0, 1]
export function hash2(x, z) {
  let h = (x * 374761393 + z * 668265263) | 0;
  h = ((h ^ (h >> 13)) * 1274126177) | 0;
  return ((h ^ (h >> 16)) & 0x7fffffff) / 0x7fffffff;
}

// 2D value noise → [0, 1]
function valueNoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// 分形布朗运动（4 octaves）
export function fbm2(x, z) {
  let val = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < 4; i++) {
    val += amp * valueNoise(x * freq, z * freq);
    amp *= 0.5;
    freq *= 2.0;
  }
  return val;
}

// 坡度估算（邻域高度差）
export function estimateSlope(x, z, heightFn) {
  const d = 4;
  const dx = heightFn(x + d, z) - heightFn(x - d, z);
  const dz = heightFn(x, z + d) - heightFn(x, z - d);
  return clamp((Math.abs(dx) + Math.abs(dz)) / (d * 2), 0, 1);
}

// 贴地放置
export function placeOnGround(x, z, heightFn) {
  return { x, y: heightFn(x, z), z };
}
