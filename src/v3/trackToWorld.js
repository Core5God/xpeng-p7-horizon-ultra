// Horizon V3 — Track-to-World (grey-box) PR1
// task-20260621-V3-PR1
//
// 读 Track JSON → 等弧长重采样 → 生成：
//   1. 灰模路面 ribbon（纯灰模材质，不贴图）
//   2. 地形高度场（跟着路面起伏：山谷下凹 / 山顶隆起 / 海边压低）
//   3. 沿弧长 chunk 边界数据（供 PR3 流式，本棒只存边界、不卸载）
// 同时输出可供车辆采样的中心线（环线、等弧长），让车能开完整一圈。

import * as THREE from 'three';
import { normalizeTrack, classifyControlPoint } from './trackSchema.js';
import { sampleClosedSpline, resampleByArc, arcLengths } from './trackSpline.js';

export function buildTrackWorld(rawTrack) {
  const track = normalizeTrack(rawTrack);
  const cps = track.controlPoints;
  if (cps.length < 3) throw new Error('Track 需要至少 3 个控制点');

  // 1) 密集样条 → 等弧长重采样中心线
  const dense = sampleClosedSpline(cps, 28);
  const stepM = 4;
  const center = resampleByArc(dense, stepM); // [{x,y,z,roadWidth,bankDeg,s}]
  const N = center.length;
  const total = arcLengths(center).total;

  // 切线/法线（环线）
  for (let i = 0; i < N; i++) {
    const a = center[i], b = center[(i + 1) % N];
    let tx = b.x - a.x, tz = b.z - a.z;
    const len = Math.hypot(tx, tz) || 1;
    a.tx = tx / len; a.tz = tz / len;
    a.nx = -a.tz; a.nz = a.tx; // 左法线
  }

  // PR1.0.1 — 为每个中心点标记所属段类型（按最近控制点），供 HUD 显示当前路段。
  for (let i = 0; i < N; i++) {
    const c = center[i];
    let best = Infinity, bi = 0;
    for (let j = 0; j < cps.length; j++) {
      const d = Math.hypot(cps[j].pos.x - c.x, cps[j].pos.z - c.z);
      if (d < best) { best = d; bi = j; }
    }
    const st = classifyControlPoint(cps[bi]);
    c.segName = st.name; c.segKey = st.key;
  }

  // 2) 灰模路面 ribbon 几何
  const ribbon = buildRibbonGeometry(center);

  // 3) 地形高度场（灰模）：基于到路面的距离与路面 y 做平滑下凹/隆起
  const terrain = buildTerrain(center, track.settings.terrainFollowRadius);

  // 4) chunk 边界（沿弧长按 chunkLength 切）
  const chunks = buildChunks(center, total, track.settings.chunkLength);

  // 5) 路面方向箭头（灰模阶段允许：指示往哪开）
  const arrows = buildDirectionArrows(center, total);

  return { track, center, total, ribbon, terrain, chunks, arrows };
}

function buildRibbonGeometry(center) {
  const N = center.length;
  const positions = [];
  const indices = [];
  const normals = [];
  for (let i = 0; i < N; i++) {
    const c = center[i];
    const hw = c.roadWidth / 2;
    // banking：绕切线倾斜，简单用法线方向抬高一侧
    const bank = (c.bankDeg || 0) * Math.PI / 180;
    const dy = Math.sin(bank) * hw;
    const lx = c.x + c.nx * hw, lz = c.z + c.nz * hw, ly = c.y + dy + 0.15;
    const rx = c.x - c.nx * hw, rz = c.z - c.nz * hw, ry = c.y - dy + 0.15;
    positions.push(lx, ly, lz, rx, ry, rz);
    normals.push(0, 1, 0, 0, 1, 0);
  }
  for (let i = 0; i < N; i++) {
    const a = i * 2, b = ((i + 1) % N) * 2;
    indices.push(a, a + 1, b);
    indices.push(b, a + 1, b + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0xd8dde4, roughness: 0.7, metalness: 0.0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'v3-road-ribbon';
  // 路缘线：两侧深色边线，从以上/远处拉出路面轮廓（与地形明显区分）
  const edgePos = [];
  for (let i = 0; i < N; i++) {
    const c = center[i];
    const hw = c.roadWidth / 2;
    edgePos.push(c.x + c.nx * hw, c.y + 0.5, c.z + c.nz * hw);
  }
  edgePos.push(edgePos[0], edgePos[1], edgePos[2]);
  const rightPos = [];
  for (let i = 0; i < N; i++) {
    const c = center[i];
    const hw = c.roadWidth / 2;
    rightPos.push(c.x - c.nx * hw, c.y + 0.5, c.z - c.nz * hw);
  }
  rightPos.push(rightPos[0], rightPos[1], rightPos[2]);
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x20262e });
  const lGeo = new THREE.BufferGeometry();
  lGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgePos, 3));
  const rGeo = new THREE.BufferGeometry();
  rGeo.setAttribute('position', new THREE.Float32BufferAttribute(rightPos, 3));
  mesh.add(new THREE.Line(lGeo, edgeMat));
  mesh.add(new THREE.Line(rGeo, edgeMat));
  return mesh;
}

// 地形高度采样器（灰模）：路面附近跟随路 y，远处回落到基准海拔。
// 海边段（路 y 很低）压低周边形成海面；山顶（路 y 高）周边隆起。
function buildTerrain(center, followR) {
  // 建一个粗网格 plane，按到最近中心点距离混合路面 y 与基准。
  // 为了 headless 自检轻量，网格分辨率适中。
  const N = center.length;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const c of center) {
    minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
    minZ = Math.min(minZ, c.z); maxZ = Math.max(maxZ, c.z);
  }
  const pad = followR * 2 + 200;
  minX -= pad; maxX += pad; minZ -= pad; maxZ += pad;
  const SEG = 128;
  const geo = new THREE.PlaneGeometry(maxX - minX, maxZ - minZ, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const baseY = -8; // 基准海拔（海平面以下一点的灰模地基）
  // 平滑高度场：多点反距离加权（消除单最近点造成的尖锐折面噪点）
  const sampleSmooth = makeSmoothFn(center);
  const blendR = Math.max(followR * 3.0, 200);
  const cols = SEG + 1;
  const heights = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const wx = pos.getX(i) + cx;
    const wz = pos.getZ(i) + cz;
    const { d, y } = sampleSmooth(wx, wz, blendR);
    const t = Math.min(1, d / blendR);
    const k = t * t * (3 - 2 * t); // smoothstep
    heights[i] = y * (1 - k) + baseY * k;
  }
  // 网格 Laplacian 平滑几轮 → 去掉残余折面，读得出是地貌而非噪声
  smoothGrid(heights, cols, cols, 3);
  for (let i = 0; i < pos.count; i++) pos.setY(i, heights[i] - 1.5);
  geo.computeVertexNormals();
  // 灰模地形：明显比路面暗的灰阶，与路面拉开层级；vertexColors 按高度分层
  applyTerrainHeightTint(geo);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 1.0, metalness: 0.0, flatShading: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'v3-terrain';
  mesh.userData.offset = { cx, cz };
  return mesh;
}

// 按高度给地形分层着色（暗灰阶梯度），避免随机噪声感，与亮路面拉开对比。
function applyTerrainHeightTint(geo) {
  const pos = geo.attributes.position;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); if (y < minY) minY = y; if (y > maxY) maxY = y; }
  const span = Math.max(1, maxY - minY);
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - minY) / span; // 0 低～1 高
    const ts = t * t * (3 - 2 * t); // smoothstep → 分层柔和，不放大折面
    // 低处偏深蓝灰（谷/海边），高处偏中灰（山顶）；整体明显暗于亮路面
    const r = 0.20 + ts * 0.24;
    const g = 0.24 + ts * 0.25;
    const b = 0.29 + ts * 0.22;
    colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
}

function makeNearestFn(center) {
  const cell = 50;
  const grid = new Map();
  const key = (gx, gz) => gx + ',' + gz;
  center.forEach((c, i) => {
    const gx = Math.floor(c.x / cell), gz = Math.floor(c.z / cell);
    const k = key(gx, gz);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  });
  return (wx, wz) => {
    const gx = Math.floor(wx / cell), gz = Math.floor(wz / cell);
    let best = Infinity, bestY = 0;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const arr = grid.get(key(gx + dx, gz + dz));
        if (!arr) continue;
        for (const i of arr) {
          const c = center[i];
          const dd = Math.hypot(c.x - wx, c.z - wz);
          if (dd < best) { best = dd; bestY = c.y; }
        }
      }
    }
    if (best === Infinity) {
      // 退化：全量扫描（边缘格）
      for (const c of center) {
        const dd = Math.hypot(c.x - wx, c.z - wz);
        if (dd < best) { best = dd; bestY = c.y; }
      }
    }
    return { d: best, y: bestY };
  };
}

// 平滑采样：返回函数 (wx,wz,R) → {d:最近路面距离, y:反距离加权路面高度}。
// 多点加权避免单最近点的阶跃折面，使谷/顶/海边高低过渡连续。
function makeSmoothFn(center) {
  const cell = 80;
  const grid = new Map();
  const key = (gx, gz) => gx + ',' + gz;
  center.forEach((c, i) => {
    const gx = Math.floor(c.x / cell), gz = Math.floor(c.z / cell);
    const k = key(gx, gz);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  });
  return (wx, wz, R) => {
    const gx = Math.floor(wx / cell), gz = Math.floor(wz / cell);
    const span = Math.ceil(R / cell) + 1;
    let best = Infinity, wsum = 0, ysum = 0;
    for (let dx = -span; dx <= span; dx++) {
      for (let dz = -span; dz <= span; dz++) {
        const arr = grid.get(key(gx + dx, gz + dz));
        if (!arr) continue;
        for (const i of arr) {
          const c = center[i];
          const dd = Math.hypot(c.x - wx, c.z - wz);
          if (dd < best) best = dd;
          if (dd < R) {
            const w = 1 / (dd * dd + 25); // 反距离平方权重
            wsum += w; ysum += w * c.y;
          }
        }
      }
    }
    if (wsum === 0) {
      // 退化：取全量最近点 y
      let by = 0; best = Infinity;
      for (const c of center) { const dd = Math.hypot(c.x - wx, c.z - wz); if (dd < best) { best = dd; by = c.y; } }
      return { d: best, y: by };
    }
    return { d: best, y: ysum / wsum };
  };
}

// 网格 Laplacian 平滑：对 (cols x rows) 高度场做 iters 轮 4-邻均值，去锐角噪点。
function smoothGrid(h, cols, rows, iters) {
  const tmp = new Float32Array(h.length);
  for (let it = 0; it < iters; it++) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        let s = h[idx], n = 1;
        if (c > 0) { s += h[idx - 1]; n++; }
        if (c < cols - 1) { s += h[idx + 1]; n++; }
        if (r > 0) { s += h[idx - cols]; n++; }
        if (r < rows - 1) { s += h[idx + cols]; n++; }
        tmp[idx] = s / n;
      }
    }
    h.set(tmp);
  }
}

// 路面方向箭头：沿中心线每隔一段贴一个朝前三角箭（贴路面略高）。
function buildDirectionArrows(center, total) {
  const grp = new THREE.Group();
  grp.name = 'v3-dir-arrows';
  const N = center.length;
  const spacing = 80; // 每 80m 一个箭头
  const count = Math.max(6, Math.floor(total / spacing));
  const mat = new THREE.MeshBasicMaterial({ color: 0x9fe0ff });
  // 三角形箭头（平躺在 XZ，尖朝 +Z）
  const shape = new THREE.Shape();
  shape.moveTo(0, 3.2); shape.lineTo(-2.2, -2.2); shape.lineTo(2.2, -2.2); shape.closePath();
  const arrowGeo = new THREE.ShapeGeometry(shape);
  arrowGeo.rotateX(-Math.PI / 2); // 躺平
  for (let k = 0; k < count; k++) {
    const idx = Math.floor((k / count) * N) % N;
    const a = center[idx];
    const m = new THREE.Mesh(arrowGeo, mat);
    m.position.set(a.x, a.y + 0.35, a.z);
    m.rotation.y = Math.atan2(a.tx, a.tz);
    grp.add(m);
  }
  return grp;
}

function buildChunks(center, total, chunkLength) {
  const count = Math.max(1, Math.round(total / chunkLength));
  const chunks = [];
  for (let k = 0; k < count; k++) {
    const sStart = (k / count) * total;
    const sEnd = ((k + 1) / count) * total;
    const idx = [];
    center.forEach((c, i) => { if (c.s >= sStart && c.s < sEnd) idx.push(i); });
    chunks.push({ index: k, sStart, sEnd, sampleIdx: idx });
  }
  return chunks;
}
