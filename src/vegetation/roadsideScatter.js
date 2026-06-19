// ---------- 道路边缘生态带 ----------
// 沿道路生成自然过渡的生态带：短草 → 花 → 碎石 → 灌木 → 小树
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getTerrainMasks } from '../terrainMasks.js';
import { randomRange, clamp } from './vegetationUtils.js';

// 路边花草贴图
function wildflowerTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 64, 64);
  // 茎
  for (let i = 0; i < 4; i++) {
    const x = 10 + Math.random() * 44;
    g.strokeStyle = `rgba(${80+Math.random()*40|0},${130+Math.random()*40|0},${50+Math.random()*30|0},0.8)`;
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(x, 62);
    g.lineTo(x + (Math.random()-0.5)*8, 62 - 30 - Math.random()*25);
    g.stroke();
    // 花朵
    const fy = 62 - 30 - Math.random() * 25;
    const fx = x + (Math.random()-0.5)*8;
    const colors = ['#ff6688','#ffcc44','#ff88aa','#ffffff','#aaccff'];
    g.fillStyle = colors[Math.floor(Math.random()*colors.length)];
    for (let p = 0; p < 5; p++) {
      const pa = p / 5 * Math.PI * 2;
      g.beginPath();
      g.ellipse(fx + Math.cos(pa)*3, fy + Math.sin(pa)*3, 2.5, 2, pa, 0, Math.PI*2);
      g.fill();
    }
    g.fillStyle = '#ffdd66';
    g.beginPath(); g.arc(fx, fy, 1.5, 0, Math.PI*2); g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
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
  const flowerGeo = new THREE.PlaneGeometry(0.4, 0.4);
  const flowerGeo2 = flowerGeo.clone();
  flowerGeo2.rotateY(Math.PI / 2);
  const crossFlower = mergeGeometries([flowerGeo, flowerGeo2]);

  const flowerMat = new THREE.MeshLambertMaterial({
    map: wildflowerTexture(),
    alphaTest: 0.4,
    side: THREE.DoubleSide,
    vertexColors: true
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

  // 碎石和低多边形灌木已移除（远古几何体太丑），由实体树/草层覆盖

  console.log(`[ROADSIDE] 花 ${fi}/${FLOWER_COUNT}`);
}
