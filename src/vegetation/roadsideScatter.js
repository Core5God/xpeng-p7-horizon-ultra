// ---------- 道路边缘生态带 ----------
// PR4.1 Roadside Ground Detail：让道路边缘 0–20m 自然起来，不再像“路面直接贴在地形上”。
// 近路肩 0–6m：碎石 / 短草 / 路边土色过渡 / 轻微污渍 / 少量花点 / 低矮草簇。
// 外路肩 6–20m：小灌木 / 小花 / 石头组 / 干草簇 / 稀疏低矮植被。
// 所有散布点用 seeded rng，沿 road samples/normals 取左右法线偏移，严格避开 road width。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getTerrainMasks } from '../terrainMasks.js';
import { clamp, makeRng, rngRange } from './vegetationUtils.js';

// 花簇贴图：叶片 + 花朵填满画布
function wildflowerTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  // 先画茎叶（覆盖下半部分）
  for (let i = 0; i < 8; i++) {
    const x = 10 + Math.random() * 108;
    const h = 40 + Math.random() * 50;
    const bend = (Math.random() - 0.5) * 20;
    const gr = 100 + Math.random() * 80 | 0;
    g.strokeStyle = `rgba(${40 + Math.random()*30|0},${gr},${30 + Math.random()*20|0},0.9)`;
    g.lineWidth = 2 + Math.random() * 2;
    g.beginPath();
    g.moveTo(x, 127);
    g.quadraticCurveTo(x + bend * 0.4, 127 - h * 0.5, x + bend, 127 - h);
    g.stroke();
    // 小叶片
    if (Math.random() > 0.4) {
      const ly = 127 - h * (0.3 + Math.random() * 0.3);
      const lx = x + bend * (ly / (127 - h));
      g.fillStyle = `rgba(${50 + Math.random()*30|0},${110 + Math.random()*60|0},${30 + Math.random()*20|0},0.85)`;
      g.beginPath();
      g.ellipse(lx + (Math.random() > 0.5 ? 5 : -5), ly, 6, 3, Math.random() * 0.5, 0, Math.PI * 2);
      g.fill();
    }
  }
  // 花朵（覆盖上半部分）
  const petalColors = ['#ff6688', '#ffcc44', '#ff99bb', '#ffffff', '#aaddff', '#ffaa55', '#dd88ff'];
  for (let i = 0; i < 6; i++) {
    const fx = 15 + Math.random() * 98;
    const fy = 10 + Math.random() * 60;
    const petalColor = petalColors[Math.floor(Math.random() * petalColors.length)];
    const petalSize = 4 + Math.random() * 5;
    // 5 片花瓣
    for (let p = 0; p < 5; p++) {
      const pa = p / 5 * Math.PI * 2;
      g.fillStyle = petalColor;
      g.beginPath();
      g.ellipse(fx + Math.cos(pa) * petalSize, fy + Math.sin(pa) * petalSize, petalSize * 0.7, petalSize * 0.45, pa, 0, Math.PI * 2);
      g.fill();
    }
    // 花蕊
    g.fillStyle = '#ffdd44';
    g.beginPath();
    g.arc(fx, fy, petalSize * 0.35, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

// 灌木几何（低多面体）
function bushGeometry() {
  const g = new THREE.IcosahedronGeometry(0.8, 1);
  // 压扁 + 随机扰动
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let y = pos.getY(i);
    if (y < 0) pos.setY(i, y * 0.2); // 底部压平
    pos.setX(i, pos.getX(i) + (Math.random()-0.5)*0.15);
    pos.setZ(i, pos.getZ(i) + (Math.random()-0.5)*0.15);
  }
  g.translate(0, 0.35, 0);
  g.computeVertexNormals();
  return g;
}

// 草簇贴图：竖向草叶（短草/干草共用，dry 控制色调）
function grassTuftTexture(dry) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 64, 64);
  const n = 14 + Math.floor(Math.random() * 8);
  for (let i = 0; i < n; i++) {
    const x = 6 + Math.random() * 52;
    const h = 26 + Math.random() * 34;
    const bend = (Math.random() - 0.5) * 18;
    const w = 1.5 + Math.random() * 2;
    let r, gg, b;
    if (dry) {
      r = 150 + Math.random() * 60 | 0; gg = 130 + Math.random() * 50 | 0; b = 60 + Math.random() * 30 | 0;
    } else {
      r = 60 + Math.random() * 40 | 0; gg = 110 + Math.random() * 70 | 0; b = 40 + Math.random() * 25 | 0;
    }
    g.strokeStyle = `rgba(${r},${gg},${b},0.92)`;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x, 63);
    g.quadraticCurveTo(x + bend * 0.5, 63 - h * 0.5, x + bend, 63 - h);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

// 交叉面片几何（草簇用）：两面十字，贴地
function crossBladeGeometry(w, h) {
  const a = new THREE.PlaneGeometry(w, h);
  a.translate(0, h * 0.5, 0);
  const b = a.clone(); b.rotateY(Math.PI / 2);
  return mergeGeometries([a, b]);
}

// 路边土色过渡贴片：贴地水平面片（碎石/土色斑块）
function dirtPatchGeometry(r) {
  const g = new THREE.CircleGeometry(r, 7);
  g.rotateX(-Math.PI / 2);
  return g;
}

/**
 * 构建道路边缘生态带
 * @param {object} opts
 * @param {THREE.Scene} opts.scene
 * @param {Array} opts.samples - 主路采样点
 * @param {Array} opts.normals - 主路法线
 * @param {Function} opts.meshGroundHeight
 * @param {Function} opts.nearestRoad
 * @param {Function} opts.branchInfo
 * @param {Function} opts.islandBase
 * @param {number} opts.HALF_W - 主路半宽
 */
export function buildRoadsideEcology(opts) {
  const { scene, samples, normals, meshGroundHeight, nearestRoad, branchInfo, islandBase, HALF_W } = opts;
  const ctx = { meshGroundHeight, groundHeight: opts.groundHeight || meshGroundHeight, nearestRoad, branchInfo, islandBase };

  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  // seeded rng：保证每次刷新稳定、不随机漂移（仅 build 阶段调用）
  const rng = makeRng(opts.seed != null ? opts.seed : 0x50AD5113);
  const rr = (a, b) => rngRange(rng, a, b);

  // ---------- 路边花簇 ----------
  const flowerGeo = new THREE.PlaneGeometry(0.5, 0.6);
  flowerGeo.translate(0, 0.3, 0);
  const flowerGeo2 = flowerGeo.clone();
  flowerGeo2.rotateY(Math.PI / 2);
  const crossFlower = mergeGeometries([flowerGeo, flowerGeo2]);

  const flowerMat = new THREE.MeshLambertMaterial({
    map: wildflowerTexture(),
    alphaTest: 0.15,        // 低阈值保留更多花瓣
    side: THREE.DoubleSide,
    color: 0xffffff         // 白色底：花色完全由贴图 + instanceColor 控制
  });

  const FLOWER_COUNT = 3500;
  const flowerInst = new THREE.InstancedMesh(crossFlower, flowerMat, FLOWER_COUNT);
  let fi = 0, guard = 0;

  // 沿道路采样放置
  for (let i = 0; i < samples.length && fi < FLOWER_COUNT; i += 2) {
    const p = samples[i];
    const n = normals[i];

    for (const side of [-1, 1]) {
      if (fi >= FLOWER_COUNT) break;
      if (rng() > 0.7) continue; // 高采样率确保路边花草密集

      const dist = rr(HALF_W + 6, HALF_W + 18); // 12-24m from center = 6-18m 草花带
      const jitter = rr(-1.5, 1.5);
      const x = p.x + n.x * side * dist + jitter;
      const z = p.z + n.z * side * dist + jitter;

      const m = getTerrainMasks(x, z, ctx);
      if (m.height < 0.8 || m.height > 14) continue;
      if (m.slope > 0.4) continue;
      if (m.roadDist < HALF_W + 1) continue;

      const y = m.height - 0.04;
      dummy.position.set(x, y, z);
      dummy.rotation.y = rng() * Math.PI;
      const s = 0.6 + rng() * 0.8;
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      flowerInst.setMatrixAt(fi, dummy.matrix);

      col.setHSL(
        [0.95, 0.13, 0.0, 0.78, 0.55][Math.floor(rng()*5)],
        0.65 + rng() * 0.2,
        0.60 + rng() * 0.15
      );
      flowerInst.setColorAt(fi, col);
      fi++;
    }
  }

  flowerInst.count = fi;
  flowerInst.instanceMatrix.needsUpdate = true;
  if (flowerInst.instanceColor) flowerInst.instanceColor.needsUpdate = true;
  scene.add(flowerInst);

  // ---------- 路边碎石 ----------
  const gravelGeo = new THREE.DodecahedronGeometry(0.25, 0);
  const gravelMat = new THREE.MeshStandardMaterial({
    color: 0x8a8278, roughness: 0.95, flatShading: true
  });

  const GRAVEL_COUNT = 1800;
  const gravelInst = new THREE.InstancedMesh(gravelGeo, gravelMat, GRAVEL_COUNT);
  let gvi = 0; guard = 0;

  while (gvi < GRAVEL_COUNT && guard++ < GRAVEL_COUNT * 5) {
    const si = Math.floor(rng() * samples.length);
    const p = samples[si];
    const n = normals[si];
    const side = rng() < 0.5 ? 1 : -1;
    const dist = rr(HALF_W + 0.5, HALF_W + 6);
    const x = p.x + n.x * side * dist + rr(-0.8, 0.8);
    const z = p.z + n.z * side * dist + rr(-0.8, 0.8);

    const m = getTerrainMasks(x, z, ctx);
    if (m.height < 0.5 || m.height > 15) continue;

    const y = m.height - 0.08;
    dummy.position.set(x, y, z);
    dummy.rotation.set(rng()*0.5, rng()*Math.PI, rng()*0.5);
    const s = 0.3 + rng() * 0.8;
    dummy.scale.set(s, s * 0.5, s);
    dummy.updateMatrix();
    gravelInst.setMatrixAt(gvi, dummy.matrix);
    gvi++;
  }

  gravelInst.count = gvi;
  gravelInst.instanceMatrix.needsUpdate = true;
  scene.add(gravelInst);

  // ---------- 路边小灌木 ----------
  const bGeo = bushGeometry();
  const bMat = new THREE.MeshStandardMaterial({
    color: 0x4a7a3a, roughness: 0.85, flatShading: true, vertexColors: true
  });

  const BUSH_ROAD_COUNT = 1400;
  const bushInst = new THREE.InstancedMesh(bGeo, bMat, BUSH_ROAD_COUNT);
  let bi = 0; guard = 0;

  for (let i = 0; i < samples.length && bi < BUSH_ROAD_COUNT; i += 3) {
    const p = samples[i];
    const n = normals[i];

    for (const side of [-1, 1]) {
      if (bi >= BUSH_ROAD_COUNT) break;
      if (rng() > 0.6) continue;

      const dist = rr(HALF_W + 7, HALF_W + 19);
      const x = p.x + n.x * side * dist + rr(-2, 2);
      const z = p.z + n.z * side * dist + rr(-2, 2);

      const m = getTerrainMasks(x, z, ctx);
      if (m.height < 1.0 || m.height > 16) continue;
      if (m.slope > 0.4) continue;
      if (m.roadDist < HALF_W + 6) continue;

      const y = m.height - 0.12;
      dummy.position.set(x, y, z);
      dummy.rotation.y = rng() * Math.PI;
      const s = 0.5 + rng() * 0.9;
      dummy.scale.set(s, s * (0.6 + rng() * 0.6), s);
      dummy.updateMatrix();
      bushInst.setMatrixAt(bi, dummy.matrix);

      col.setHSL(0.26 + rng() * 0.06, 0.40 + rng() * 0.15, 0.22 + rng() * 0.12);
      bushInst.setColorAt(bi, col);
      bi++;
    }
  }

  bushInst.count = bi;
  bushInst.instanceMatrix.needsUpdate = true;
  if (bushInst.instanceColor) bushInst.instanceColor.needsUpdate = true;
  bushInst.castShadow = true;
  bushInst.receiveShadow = true;
  scene.add(bushInst);

  // ====================================================================
  // PR4.1 路边地编细节（0–20m）—— 让路面与地形过渡更自然
  // ====================================================================

  // ---------- 近路肩短草簇（0–6m，贴路但不穿路）----------
  const shortGrassGeo = crossBladeGeometry(0.5, 0.42);
  const shortGrassMat = new THREE.MeshLambertMaterial({
    map: grassTuftTexture(false), alphaTest: 0.28, side: THREE.DoubleSide, color: 0xffffff
  });
  const SHORT_GRASS_COUNT = 5200;
  const sgInst = new THREE.InstancedMesh(shortGrassGeo, shortGrassMat, SHORT_GRASS_COUNT);
  let sgi = 0; guard = 0;
  while (sgi < SHORT_GRASS_COUNT && guard++ < SHORT_GRASS_COUNT * 4) {
    const si = Math.floor(rng() * samples.length);
    const p = samples[si], n = normals[si];
    const side = rng() < 0.5 ? 1 : -1;
    // 近路肩 0–6m：edge=HALF_W 起，偏 0.6–6m
    const dist = HALF_W + rr(0.6, 6.0);
    const x = p.x + n.x * side * dist + rr(-0.9, 0.9);
    const z = p.z + n.z * side * dist + rr(-0.9, 0.9);
    const m = getTerrainMasks(x, z, ctx);
    if (m.roadDist < HALF_W + 0.4) continue; // 严格避开路面
    if (m.height < 0.6 || m.height > 15) continue;
    if (m.slope > 0.5) continue;
    // 越贴路越短（路肩过渡）
    const edge = clamp((m.roadDist - HALF_W) / 6, 0, 1);
    const y = m.height - 0.03;
    dummy.position.set(x, y, z);
    dummy.rotation.y = rng() * Math.PI;
    const s = 0.45 + edge * 0.5 + rng() * 0.35;
    dummy.scale.set(s, s * (0.7 + rng() * 0.5), s);
    dummy.updateMatrix();
    sgInst.setMatrixAt(sgi, dummy.matrix);
    // 近路肩偏黄枯（土色过渡），远一点偏绿
    col.setHSL(0.20 + edge * 0.07 + rng() * 0.03, 0.32 + rng() * 0.18, 0.34 + rng() * 0.12);
    sgInst.setColorAt(sgi, col);
    sgi++;
  }
  sgInst.count = sgi;
  sgInst.instanceMatrix.needsUpdate = true;
  if (sgInst.instanceColor) sgInst.instanceColor.needsUpdate = true;
  scene.add(sgInst);

  // ---------- 路边土色过渡贴片 + 轻微污渍（0–3.5m）----------
  const dirtGeo = dirtPatchGeometry(1.0);
  const dirtMat = new THREE.MeshLambertMaterial({
    color: 0x6e6052, transparent: true, opacity: 0.55,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
  });
  const DIRT_COUNT = 2200;
  const dirtInst = new THREE.InstancedMesh(dirtGeo, dirtMat, DIRT_COUNT);
  let di = 0; guard = 0;
  while (di < DIRT_COUNT && guard++ < DIRT_COUNT * 4) {
    const si = Math.floor(rng() * samples.length);
    const p = samples[si], n = normals[si];
    const side = rng() < 0.5 ? 1 : -1;
    const dist = HALF_W + rr(0.3, 3.5);
    const x = p.x + n.x * side * dist + rr(-0.6, 0.6);
    const z = p.z + n.z * side * dist + rr(-0.6, 0.6);
    const m = getTerrainMasks(x, z, ctx);
    if (m.roadDist < HALF_W + 0.2) continue;
    if (m.height < 0.5 || m.height > 15) continue;
    if (m.slope > 0.55) continue;
    const y = m.height + 0.015;
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, rng() * Math.PI, 0);
    const s = 0.5 + rng() * 1.1;
    dummy.scale.set(s, 1, s * (0.7 + rng() * 0.5));
    dummy.updateMatrix();
    dirtInst.setMatrixAt(di, dummy.matrix);
    // 土色→污渍：深浅棕褐 / 偷偏灰
    const v = rng();
    col.setHSL(0.07 + rng() * 0.03, 0.18 + rng() * 0.12, 0.22 + v * 0.12);
    dirtInst.setColorAt(di, col);
    di++;
  }
  dirtInst.count = di;
  dirtInst.instanceMatrix.needsUpdate = true;
  if (dirtInst.instanceColor) dirtInst.instanceColor.needsUpdate = true;
  scene.add(dirtInst);

  // ---------- 外路肩干草簇（6–20m，稀疏低矮植被）----------
  const dryGrassGeo = crossBladeGeometry(0.6, 0.7);
  const dryGrassMat = new THREE.MeshLambertMaterial({
    map: grassTuftTexture(true), alphaTest: 0.28, side: THREE.DoubleSide, color: 0xffffff
  });
  const DRY_GRASS_COUNT = 3000;
  const dgInst = new THREE.InstancedMesh(dryGrassGeo, dryGrassMat, DRY_GRASS_COUNT);
  let dgi = 0; guard = 0;
  while (dgi < DRY_GRASS_COUNT && guard++ < DRY_GRASS_COUNT * 4) {
    const si = Math.floor(rng() * samples.length);
    const p = samples[si], n = normals[si];
    const side = rng() < 0.5 ? 1 : -1;
    const dist = HALF_W + rr(6.0, 20.0);
    const x = p.x + n.x * side * dist + rr(-1.4, 1.4);
    const z = p.z + n.z * side * dist + rr(-1.4, 1.4);
    const m = getTerrainMasks(x, z, ctx);
    if (m.roadDist < HALF_W + 5.5) continue;
    if (m.height < 0.8 || m.height > 16) continue;
    if (m.slope > 0.5) continue;
    // 稀疏：用 noise 控制密度，避免均匀噪点
    if (m.noise < 0.42 && rng() > 0.5) continue;
    const y = m.height - 0.04;
    dummy.position.set(x, y, z);
    dummy.rotation.y = rng() * Math.PI;
    const s = 0.6 + rng() * 0.7;
    dummy.scale.set(s, s * (0.8 + rng() * 0.6), s);
    dummy.updateMatrix();
    dgInst.setMatrixAt(dgi, dummy.matrix);
    col.setHSL(0.13 + rng() * 0.05, 0.30 + rng() * 0.18, 0.38 + rng() * 0.12);
    dgInst.setColorAt(dgi, col);
    dgi++;
  }
  dgInst.count = dgi;
  dgInst.instanceMatrix.needsUpdate = true;
  if (dgInst.instanceColor) dgInst.instanceColor.needsUpdate = true;
  scene.add(dgInst);

  // ---------- 外路肩石头组（6–20m）----------
  const stoneGeo = new THREE.DodecahedronGeometry(0.45, 0);
  const stoneMat = new THREE.MeshStandardMaterial({
    color: 0x9a9388, roughness: 0.95, flatShading: true, vertexColors: true
  });
  const STONE_COUNT = 1300;
  const stoneInst = new THREE.InstancedMesh(stoneGeo, stoneMat, STONE_COUNT);
  let sti = 0; guard = 0;
  while (sti < STONE_COUNT && guard++ < STONE_COUNT * 6) {
    // 石头“组”：选一个中心，周围集 2–4 块
    const si = Math.floor(rng() * samples.length);
    const p = samples[si], n = normals[si];
    const side = rng() < 0.5 ? 1 : -1;
    const baseDist = HALF_W + rr(6.5, 19.0);
    const cx = p.x + n.x * side * baseDist;
    const cz = p.z + n.z * side * baseDist;
    const cluster = 2 + Math.floor(rng() * 3);
    for (let k = 0; k < cluster && sti < STONE_COUNT; k++) {
      const x = cx + rr(-1.2, 1.2);
      const z = cz + rr(-1.2, 1.2);
      const m = getTerrainMasks(x, z, ctx);
      if (m.roadDist < HALF_W + 6) continue;
      if (m.height < 0.7 || m.height > 17) continue;
      const y = m.height - 0.06;
      dummy.position.set(x, y, z);
      dummy.rotation.set(rng() * 0.6, rng() * Math.PI, rng() * 0.6);
      const s = 0.35 + rng() * 0.95;
      dummy.scale.set(s, s * (0.5 + rng() * 0.4), s);
      dummy.updateMatrix();
      stoneInst.setMatrixAt(sti, dummy.matrix);
      const g = 0.50 + rng() * 0.12;
      col.setRGB(g + rng() * 0.05, g, g - rng() * 0.06);
      stoneInst.setColorAt(sti, col);
      sti++;
    }
  }
  stoneInst.count = sti;
  stoneInst.instanceMatrix.needsUpdate = true;
  if (stoneInst.instanceColor) stoneInst.instanceColor.needsUpdate = true;
  stoneInst.castShadow = true;
  stoneInst.receiveShadow = true;
  scene.add(stoneInst);

  console.log(`[ROADSIDE] 花 ${fi}/${FLOWER_COUNT}, 碎石 ${gvi}/${GRAVEL_COUNT}, 灌木 ${bi}/${BUSH_ROAD_COUNT}, 短草 ${sgi}/${SHORT_GRASS_COUNT}, 土色 ${di}/${DIRT_COUNT}, 干草 ${dgi}/${DRY_GRASS_COUNT}, 石组 ${sti}/${STONE_COUNT}`);
}
