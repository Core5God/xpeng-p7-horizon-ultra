// ---------- 道路边缘生态带 ----------
// 沿道路生成自然过渡的生态带：短草 → 花 → 碎石 → 灌木 → 小树
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getTerrainMasks } from '../terrainMasks.js';
import { randomRange, clamp } from './vegetationUtils.js';

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
      if (Math.random() > 0.7) continue; // 高采样率确保路边花草密集

      const dist = randomRange(HALF_W + 6, HALF_W + 18); // 12-24m from center = 6-18m 草花带
      const jitter = randomRange(-1.5, 1.5);
      const x = p.x + n.x * side * dist + jitter;
      const z = p.z + n.z * side * dist + jitter;

      const m = getTerrainMasks(x, z, ctx);
      if (m.height < 0.8 || m.height > 14) continue;
      if (m.slope > 0.4) continue;
      if (m.roadDist < HALF_W + 1) continue;

      const y = m.height - 0.04;
      dummy.position.set(x, y, z);
      dummy.rotation.y = Math.random() * Math.PI;
      const s = 0.6 + Math.random() * 0.8;
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      flowerInst.setMatrixAt(fi, dummy.matrix);

      col.setHSL(
        [0.95, 0.13, 0.0, 0.78, 0.55][Math.floor(Math.random()*5)],
        0.65 + Math.random() * 0.2,
        0.60 + Math.random() * 0.15
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
    const si = Math.floor(Math.random() * samples.length);
    const p = samples[si];
    const n = normals[si];
    const side = Math.random() < 0.5 ? 1 : -1;
    const dist = randomRange(HALF_W + 0.5, HALF_W + 6);
    const x = p.x + n.x * side * dist + randomRange(-0.8, 0.8);
    const z = p.z + n.z * side * dist + randomRange(-0.8, 0.8);

    const m = getTerrainMasks(x, z, ctx);
    if (m.height < 0.5 || m.height > 15) continue;

    const y = m.height - 0.08;
    dummy.position.set(x, y, z);
    dummy.rotation.set(Math.random()*0.5, Math.random()*Math.PI, Math.random()*0.5);
    const s = 0.3 + Math.random() * 0.8;
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
      if (Math.random() > 0.6) continue;

      const dist = randomRange(HALF_W + 18, HALF_W + 40);
      const x = p.x + n.x * side * dist + randomRange(-2, 2);
      const z = p.z + n.z * side * dist + randomRange(-2, 2);

      const m = getTerrainMasks(x, z, ctx);
      if (m.height < 1.0 || m.height > 16) continue;
      if (m.slope > 0.4) continue;
      if (m.roadDist < HALF_W + 14) continue;

      const y = m.height - 0.12;
      dummy.position.set(x, y, z);
      dummy.rotation.y = Math.random() * Math.PI;
      const s = 0.5 + Math.random() * 0.9;
      dummy.scale.set(s, s * (0.6 + Math.random() * 0.6), s);
      dummy.updateMatrix();
      bushInst.setMatrixAt(bi, dummy.matrix);

      col.setHSL(0.26 + Math.random() * 0.06, 0.40 + Math.random() * 0.15, 0.22 + Math.random() * 0.12);
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

  console.log(`[ROADSIDE] 花 ${fi}/${FLOWER_COUNT}, 碎石 ${gvi}/${GRAVEL_COUNT}, 灌木 ${bi}/${BUSH_ROAD_COUNT}`);
}
