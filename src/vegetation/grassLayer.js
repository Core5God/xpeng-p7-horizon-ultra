// ---------- 草地层 ----------
// 用 InstancedMesh + 真实贴图生成有体积感的草地
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getTerrainMasks } from '../terrainMasks.js';
import { randomRange, clamp } from './vegetationUtils.js';

// 近景草叶贴图：密集叶片填满整个画布，避免透明空洞
function grassBladeTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  // 背景全透明
  g.clearRect(0, 0, 128, 128);
  // 画 20+ 片宽叶片，覆盖整个画布
  for (let i = 0; i < 24; i++) {
    const x = 4 + Math.random() * 120;
    const w = 3 + Math.random() * 5;           // 宽叶片 3-8px
    const h = 50 + Math.random() * 70;          // 高度覆盖大部分画布
    const bend = (Math.random() - 0.5) * 30;
    const gr = 120 + Math.random() * 80 | 0;
    const rd = 50 + Math.random() * 50 | 0;
    const bl = 20 + Math.random() * 30 | 0;
    // 叶片填充（非描边）
    g.fillStyle = `rgba(${rd},${gr},${bl},0.95)`;
    g.beginPath();
    g.moveTo(x - w/2, 127);
    g.quadraticCurveTo(x + bend * 0.3, 127 - h * 0.5, x + bend, 127 - h);
    g.quadraticCurveTo(x + bend * 0.3 + w * 0.4, 127 - h * 0.5, x + w/2, 127);
    g.closePath();
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

// 中景草簇贴图：更高更密的草丛
function grassTuftTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  for (let i = 0; i < 30; i++) {
    const x = 2 + Math.random() * 124;
    const w = 3 + Math.random() * 6;
    const h = 60 + Math.random() * 60;
    const bend = (Math.random() - 0.5) * 35;
    const gr = 110 + Math.random() * 80 | 0;
    const rd = 40 + Math.random() * 50 | 0;
    const bl = 15 + Math.random() * 25 | 0;
    g.fillStyle = `rgba(${rd},${gr},${bl},0.92)`;
    g.beginPath();
    g.moveTo(x - w/2, 127);
    g.quadraticCurveTo(x + bend * 0.4, 127 - h * 0.6, x + bend, 127 - h);
    g.quadraticCurveTo(x + bend * 0.4 + w * 0.3, 127 - h * 0.6, x + w/2, 127);
    g.closePath();
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

/**
 * 构建草地层
 * @param {object} opts
 * @param {THREE.Scene} opts.scene
 * @param {Function} opts.meshGroundHeight
 * @param {Function} opts.groundHeight
 * @param {Function} opts.nearestRoad
 * @param {Function} opts.branchInfo
 * @param {Function} opts.islandBase
 * @param {object} opts.windU - 风摆 uniform { value: 0 }
 */
export function buildGrassLayer(opts) {
  const { scene, meshGroundHeight, groundHeight, nearestRoad, branchInfo, islandBase, windU, samples, normals } = opts;
  const ctx = { meshGroundHeight, groundHeight, nearestRoad, branchInfo, islandBase };

  // ---------- 近景短草 ----------
  // 交叉平面 + 真实草叶贴图
  const bladeA = new THREE.PlaneGeometry(0.5, 0.7);
  bladeA.translate(0, 0.35, 0);
  const bladeB = bladeA.clone();
  bladeB.rotateY(Math.PI * 0.5);
  const grassGeo = mergeGeometries([bladeA, bladeB]);

  const grassMat = new THREE.MeshLambertMaterial({
    map: grassBladeTexture(),
    alphaTest: 0.2,          // 低阈值保留更多叶片
    side: THREE.DoubleSide,
    color: 0x88cc77          // 浅绿色调：与贴图叠加产生变化
  });

  // 风摆 shader 注入
  grassMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windU;
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float phase = instanceMatrix[3].x + instanceMatrix[3].z;
        float sway = sin(uTime * 1.6 + phase * 0.15 + position.y * 2.0)
                     * 0.05 * uv.y;
        transformed.x += sway;
        transformed.z += sway * 0.4;
      #endif`
    );
  };

  const GRASS_COUNT = 28000;
  const grassInst = new THREE.InstancedMesh(grassGeo, grassMat, GRASS_COUNT);
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  let gi = 0, guard = 0;

  while (gi < GRASS_COUNT && guard++ < GRASS_COUNT * 8) {
    // 道路走廊优先放置（60% 沿路，30% 草甸热点，10% 全岛散）
    let x, z;
    const roll = Math.random();
    if (roll < 0.6 && samples && normals) {
      // 沿路走廊：随机选一个路段样本点，在旁边 8-50m 范围放置
      const si = (Math.random() * samples.length) | 0;
      const s = samples[si], n = normals[si];
      const side = Math.random() > 0.5 ? 1 : -1;
      const off = 8 + Math.random() * 42;
      x = s.x + n.x * side * off + (Math.random() - 0.5) * 6;
      z = s.z + n.z * side * off + (Math.random() - 0.5) * 6;
    } else if (roll < 0.9) {
      // 草甸热点：在中等高度区域集中
      const angle = Math.random() * Math.PI * 2;
      const radius = 50 + Math.random() * 350;
      x = Math.cos(angle) * radius;
      z = Math.sin(angle) * radius;
    } else {
      // 全岛随机散
      const angle = Math.random() * Math.PI * 2;
      const radius = 30 + Math.random() * 540;
      x = Math.cos(angle) * radius;
      z = Math.sin(angle) * radius;
    }

    // 获取生态 mask
    const m = getTerrainMasks(x, z, ctx);

    // 放置规则
    if (m.roadDist < 6) continue;          // 路面 6m 内禁放
    if (m.height < 0.8 || m.height > 18) continue;
    if (m.slope > 0.45) continue;
    if (m.rock > 0.5) continue;
    if (m.beach > 0.7) continue;

    // 密度由 fertility + meadow + roadside 决定
    const density = clamp(m.fertility * 0.6 + m.meadow * 0.8 + (m.roadDist < 24 ? 0.3 : 0), 0, 1);
    if (Math.random() > density * 0.7 + 0.15) continue;

    const y = m.height - 0.08;
    dummy.position.set(x, y, z);
    dummy.rotation.set(
      (Math.random() - 0.5) * 0.3,  // 微倾斜：消除整齐排列感
      Math.random() * Math.PI * 2,   // 全 360° 旋转
      (Math.random() - 0.5) * 0.15
    );
    const s = 0.5 + Math.random() * 0.7;
    dummy.scale.set(s, s * (0.7 + Math.random() * 0.6), s);
    dummy.updateMatrix();
    grassInst.setMatrixAt(gi, dummy.matrix);

    // instanceColor 提供色调变化（与材质色相乘，用浅色避免压暗）
    const hue = 0.25 + Math.random() * 0.1;
    const sat = 0.30 + Math.random() * 0.2;
    const lum = 0.70 + Math.random() * 0.25;  // 高亮度：不压暗贴图
    col.setHSL(hue, sat, lum);
    grassInst.setColorAt(gi, col);
    gi++;
  }

  grassInst.count = gi;
  grassInst.instanceMatrix.needsUpdate = true;
  if (grassInst.instanceColor) grassInst.instanceColor.needsUpdate = true;
  grassInst.receiveShadow = true;
  // 草不 castShadow（性能考虑）
  scene.add(grassInst);

  // ---------- 中景草簇（贴图交叉平面） ----------
  const tuftA = new THREE.PlaneGeometry(0.85, 1.2);
  tuftA.translate(0, 0.6, 0);
  const tuftB = tuftA.clone();
  tuftB.rotateY(Math.PI * 0.5);
  const tuftGeo = mergeGeometries([tuftA, tuftB]);

  const tuftMat = new THREE.MeshLambertMaterial({
    map: grassTuftTexture(),
    alphaTest: 0.2,
    side: THREE.DoubleSide,
    color: 0x77bb66       // 偏暗绿：中景草比近景深
  });
  tuftMat.onBeforeCompile = grassMat.onBeforeCompile; // 共享风摆

  const TUFT_COUNT = 8000;
  const tuftInst = new THREE.InstancedMesh(tuftGeo, tuftMat, TUFT_COUNT);
  let ti = 0; guard = 0;

  while (ti < TUFT_COUNT && guard++ < TUFT_COUNT * 6) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 50 + Math.random() * 480;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;

    const m = getTerrainMasks(x, z, ctx);
    if (m.roadDist < 8) continue;
    if (m.height < 1.5 || m.height > 16) continue;
    if (m.slope > 0.4) continue;
    if (m.rock > 0.4) continue;
    if (m.beach > 0.6) continue;

    const density = m.fertility * 0.5 + m.meadow * 0.6;
    if (Math.random() > density * 0.5 + 0.08) continue;

    const y = m.height - 0.1;
    dummy.position.set(x, y, z);
    dummy.rotation.y = Math.random() * Math.PI;
    const s = 0.6 + Math.random() * 0.8;
    dummy.scale.set(s, s * (0.8 + Math.random() * 0.5), s);
    dummy.updateMatrix();
    tuftInst.setMatrixAt(ti, dummy.matrix);

    col.setHSL(0.24 + Math.random() * 0.08, 0.35 + Math.random() * 0.15, 0.65 + Math.random() * 0.25);
    tuftInst.setColorAt(ti, col);
    ti++;
  }

  tuftInst.count = ti;
  tuftInst.instanceMatrix.needsUpdate = true;
  if (tuftInst.instanceColor) tuftInst.instanceColor.needsUpdate = true;
  tuftInst.receiveShadow = true;
  scene.add(tuftInst);

  console.log(`[GRASS] 近景草 ${gi}/${GRASS_COUNT}, 草簇 ${ti}/${TUFT_COUNT}`);
}
