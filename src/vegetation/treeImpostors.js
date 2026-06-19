// ---------- 中景树丛 impostor（35-120m billboard） ----------
// 用 cross-billboard 替代远处实体树，保持视觉密度但不增加 draw call
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getTerrainMasks } from '../terrainMasks.js';

function treeBillboardTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 192;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 192);

  // 树干
  g.fillStyle = '#5a4a3a';
  g.fillRect(56, 140, 16, 52);

  // 树冠（多层椭圆模拟松树/阔叶树轮廓）
  const layers = [
    { y: 50, w: 48, h: 36, color: '#2d5a2a' },
    { y: 75, w: 56, h: 40, color: '#3a6e35' },
    { y: 100, w: 52, h: 34, color: '#2a5528' },
    { y: 125, w: 40, h: 28, color: '#3d7238' },
  ];
  for (const l of layers) {
    g.fillStyle = l.color;
    g.beginPath();
    g.ellipse(64, l.y, l.w / 2, l.h / 2, 0, 0, Math.PI * 2);
    g.fill();
  }

  // 边缘柔化
  g.globalCompositeOperation = 'destination-out';
  const edge = g.createRadialGradient(64, 96, 40, 64, 96, 70);
  edge.addColorStop(0, 'rgba(0,0,0,0)');
  edge.addColorStop(0.85, 'rgba(0,0,0,0)');
  edge.addColorStop(1, 'rgba(0,0,0,0.7)');
  g.fillStyle = edge;
  g.fillRect(0, 0, 128, 192);

  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

/**
 * 中景树丛 impostor
 * @param {object} opts
 * @param {THREE.Scene} opts.scene
 * @param {Array} opts.samples - 道路采样点
 * @param {Array} opts.normals - 道路法线
 * @param {Function} opts.meshGroundHeight
 * @param {Function} opts.groundHeight
 * @param {Function} opts.nearestRoad
 * @param {Function} opts.branchInfo
 * @param {Function} opts.islandBase
 */
export function buildTreeImpostors(opts) {
  const { scene, samples, normals, meshGroundHeight, groundHeight, nearestRoad, branchInfo, islandBase } = opts;
  const ctx = { meshGroundHeight, groundHeight, nearestRoad, branchInfo, islandBase };

  // Cross-billboard 几何（两个垂直面）
  const planeA = new THREE.PlaneGeometry(6, 9);
  planeA.translate(0, 4.5, 0);
  const planeB = planeA.clone();
  planeB.rotateY(Math.PI / 2);
  const crossGeo = mergeGeometries([planeA, planeB]);

  const treeMat = new THREE.MeshLambertMaterial({
    map: treeBillboardTexture(),
    transparent: true,
    alphaTest: 0.2,
    side: THREE.DoubleSide,
    depthWrite: true,
    color: 0x88aa78
  });

  const IMPOSTOR_COUNT = 6000;
  const impostorInst = new THREE.InstancedMesh(crossGeo, treeMat, IMPOSTOR_COUNT);
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  let ii = 0, guard = 0;

  while (ii < IMPOSTOR_COUNT && guard++ < IMPOSTOR_COUNT * 6) {
    // 沿路走廊 35-120m 范围放置
    const si = (Math.random() * samples.length) | 0;
    const s = samples[si], n = normals[si];
    const side = Math.random() > 0.5 ? 1 : -1;
    const off = 35 + Math.random() * 85; // 35-120m from road center
    const x = s.x + n.x * side * off + (Math.random() - 0.5) * 10;
    const z = s.z + n.z * side * off + (Math.random() - 0.5) * 10;

    const m = getTerrainMasks(x, z, ctx);

    // 放置规则：中高度、低坡度、非沙滩、非岩石
    if (m.roadDist < 30) continue; // 不与近景实体树重叠
    if (m.height < 1.5 || m.height > 22) continue;
    if (m.slope > 0.5) continue;
    if (m.beach > 0.6) continue;
    if (m.rock > 0.5) continue;

    // 密度：森林和草甸区域更密
    const density = m.forest * 0.7 + m.meadow * 0.3;
    if (Math.random() > density * 0.6 + 0.15) continue;

    const y = m.height - 0.2;
    dummy.position.set(x, y, z);
    dummy.rotation.y = Math.random() * Math.PI;
    const sScale = 0.7 + Math.random() * 0.8;
    dummy.scale.set(sScale, sScale * (0.8 + Math.random() * 0.4), sScale);
    dummy.updateMatrix();
    impostorInst.setMatrixAt(ii, dummy.matrix);

    // 颜色变化
    const hue = 0.24 + Math.random() * 0.1;
    const sat = 0.3 + Math.random() * 0.2;
    const lum = 0.35 + Math.random() * 0.15;
    col.setHSL(hue, sat, lum);
    impostorInst.setColorAt(ii, col);
    ii++;
  }

  impostorInst.count = ii;
  impostorInst.instanceMatrix.needsUpdate = true;
  if (impostorInst.instanceColor) impostorInst.instanceColor.needsUpdate = true;
  impostorInst.receiveShadow = true;
  scene.add(impostorInst);

  console.log(`[IMPOSTOR] 中景树丛 ${ii}/${IMPOSTOR_COUNT}`);
}
