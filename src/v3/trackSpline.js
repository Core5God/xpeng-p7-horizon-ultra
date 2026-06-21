// Horizon V3 — Track spline math (PR1)
// task-20260621-V3-PR1
//
// 闭合 Catmull-Rom 样条：插值控制点 → 平滑环线。
// 提供：采样点生成 / 等弧长重采样 / 自交叉检测 / 闭环校验。
// 纯数学，不依赖 three（编辑器/headless 自检都能用）。

// 闭合 Catmull-Rom：在控制点 p[i-1],p[i],p[i+1],p[i+2] 之间按 t∈[0,1] 插值
// 返回 {x, z}（编辑器俯视用 x/z），y 单独由 lerpHermite 处理见下。
function crVal(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

// 由 controlPoints 生成密集采样点（闭合）。
// samplesPerSeg：每段细分数。返回 [{x,y,z,roadWidth,bankDeg, cpA, cpB, segT}]
export function sampleClosedSpline(controlPoints, samplesPerSeg = 24) {
  const n = controlPoints.length;
  const out = [];
  if (n < 3) return out;
  for (let i = 0; i < n; i++) {
    const a0 = controlPoints[(i - 1 + n) % n];
    const a1 = controlPoints[i];
    const a2 = controlPoints[(i + 1) % n];
    const a3 = controlPoints[(i + 2) % n];
    for (let s = 0; s < samplesPerSeg; s++) {
      const t = s / samplesPerSeg;
      const x = crVal(a0.pos.x, a1.pos.x, a2.pos.x, a3.pos.x, t);
      const y = crVal(a0.pos.y, a1.pos.y, a2.pos.y, a3.pos.y, t);
      const z = crVal(a0.pos.z, a1.pos.z, a2.pos.z, a3.pos.z, t);
      const w = crVal(a1.roadWidth, a1.roadWidth, a2.roadWidth, a2.roadWidth, t);
      const bank = crVal(a1.bankDeg, a1.bankDeg, a2.bankDeg, a2.bankDeg, t);
      out.push({
        x, y, z,
        roadWidth: Math.max(2, w),
        bankDeg: bank,
        cpA: i,
        cpB: (i + 1) % n,
        segT: t,
      });
    }
  }
  // 闭环：最后一个点回到第一个点附近，采样里已隐含（i 循环回 0）
  return out;
}

// 计算闭合采样点的累计弧长（环线，最后回到起点）。返回 {cum:[], total}
export function arcLengths(samples) {
  const n = samples.length;
  const cum = new Array(n + 1);
  cum[0] = 0;
  for (let i = 0; i < n; i++) {
    const a = samples[i];
    const b = samples[(i + 1) % n];
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    cum[i + 1] = cum[i] + d;
  }
  return { cum, total: cum[n] };
}

// 等弧长重采样：把不均匀样条点重采为每 stepM 米一个点（闭合）。
// 返回 [{x,y,z,roadWidth,bankDeg,s}]，s 为该点弧长位置。
export function resampleByArc(samples, stepM = 4) {
  const n = samples.length;
  if (n < 2) return [];
  const { cum, total } = arcLengths(samples);
  const count = Math.max(3, Math.round(total / stepM));
  const out = [];
  let j = 0;
  for (let k = 0; k < count; k++) {
    const target = (k / count) * total;
    while (j < n && cum[j + 1] < target) j++;
    const a = samples[j % n];
    const b = samples[(j + 1) % n];
    const segLen = cum[j + 1] - cum[j];
    const f = segLen > 1e-6 ? (target - cum[j]) / segLen : 0;
    out.push({
      x: a.x + (b.x - a.x) * f,
      y: a.y + (b.y - a.y) * f,
      z: a.z + (b.z - a.z) * f,
      roadWidth: a.roadWidth + (b.roadWidth - a.roadWidth) * f,
      bankDeg: a.bankDeg + (b.bankDeg - a.bankDeg) * f,
      s: target,
    });
  }
  return out;
}

// 线段相交（2D，x/z 平面）。返回交点参数或 null。
function segIntersect(p1, p2, p3, p4) {
  const d1x = p2.x - p1.x, d1z = p2.z - p1.z;
  const d2x = p4.x - p3.x, d2z = p4.z - p3.z;
  const denom = d1x * d2z - d1z * d2x;
  if (Math.abs(denom) < 1e-9) return null;
  const sx = p3.x - p1.x, sz = p3.z - p1.z;
  const tA = (sx * d2z - sz * d2x) / denom;
  const tB = (sx * d1z - sz * d1x) / denom;
  if (tA > 1e-6 && tA < 1 - 1e-6 && tB > 1e-6 && tB < 1 - 1e-6) {
    return { x: p1.x + d1x * tA, z: p1.z + d1z * tA };
  }
  return null;
}

// 自交叉检测（俯视 2D）。返回交点数组 [{x,z,i,j}]。
// 跳过相邻段（环线意义上）以免误报。
export function detectSelfIntersections(samples) {
  const n = samples.length;
  const hits = [];
  if (n < 4) return hits;
  for (let i = 0; i < n; i++) {
    const a1 = samples[i], a2 = samples[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      // 跳过环线首尾相邻
      if (i === 0 && j === n - 1) continue;
      const b1 = samples[j], b2 = samples[(j + 1) % n];
      const hit = segIntersect(a1, a2, b1, b2);
      if (hit) hits.push({ x: hit.x, z: hit.z, i, j });
    }
  }
  return hits;
}

// 闭环校验：首尾控制点是否能平滑闭合（CR 闭合天然成立），
// 这里检查环线总弧长合理 + 无 0 长度退化段。返回 {closed, total, degenerate}
export function checkClosure(samples) {
  const { cum, total } = arcLengths(samples);
  let degenerate = 0;
  for (let i = 0; i < samples.length; i++) {
    if (cum[i + 1] - cum[i] < 1e-4) degenerate++;
  }
  return { closed: total > 1, total, degenerate };
}
