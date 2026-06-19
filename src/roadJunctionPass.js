import * as THREE from 'three';
import { scene } from './core.js';
import {
  samples,
  normals,
  bSamples,
  bNormals,
  HALF_W,
  B_HALF,
  BRANCH_A,
  BRANCH_B,
  groundHeight
} from './world.js';

// ---------- P1 Junction Geometry Pass ----------
// 目的：替代上一版圆形 decal 补丁，生成真正顺着主路/支路边界展开的喇叭口 junction mesh。
// 解决：两套 road mesh 直接相交导致的黑色断面、贴图朝向硬碰、边线/中线穿插、圆形补丁感。
// 范围：仅处理当前支线两个端点 BRANCH_A / BRANCH_B，不重写整套道路系统。

let built = false;

function roadNoiseTexture() {
  const size = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#282a2c';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 3200; i++) {
    const v = 18 + Math.random() * 58;
    const a = 0.045 + Math.random() * 0.14;
    ctx.fillStyle = `rgba(${v},${v},${v},${a})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 2.5, 1 + Math.random() * 2.5);
  }

  // 低方向性的压实纹理，不使用长条 road UV，避免和主/支路方向冲突。
  for (let i = 0; i < 18; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.strokeStyle = `rgba(255,255,255,${0.012 + Math.random() * 0.022})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 40, y + (Math.random() - 0.5) * 18);
    ctx.bezierCurveTo(x, y - 12, x + 38, y + 16, x + 84, y + (Math.random() - 0.5) * 20);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1.8, 1.8);
  tex.anisotropy = 4;
  return tex;
}

function featherTexture() {
  const size = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const cx = size / 2;
  const cy = size / 2;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, cx);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.42, 'rgba(255,255,255,0.82)');
  g.addColorStop(0.74, 'rgba(255,255,255,0.28)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

function makeJunctionMaterial() {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x242628,
    map: roadNoiseTexture(),
    roughness: 0.88,
    metalness: 0.0,
    transparent: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    side: THREE.DoubleSide
  });
  mat.envMapIntensity = 0.18;
  return mat;
}

function makeBlendMaterial({ color = 0x3a3128, opacity = 0.28 } = {}) {
  const mat = new THREE.MeshBasicMaterial({
    color,
    alphaMap: featherTexture(),
    transparent: true,
    opacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    side: THREE.DoubleSide
  });
  return mat;
}

function tangentFromNormal(n, forward = 1) {
  return new THREE.Vector3(n.z, 0, -n.x).multiplyScalar(forward).normalize();
}

function getMainFrame(idx) {
  const i = ((idx % samples.length) + samples.length) % samples.length;
  const p = samples[i];
  const n = normals[i].clone().setY(0).normalize();
  const t = tangentFromNormal(n, 1);
  return { p, n, t, y: p.y };
}

function getBranchFrame(idx, forward = 1) {
  const i = Math.max(0, Math.min(bSamples.length - 1, idx));
  const p = bSamples[i];
  const n = bNormals[i].clone().setY(0).normalize();
  const t = tangentFromNormal(n, forward);
  return { p, n, t, y: p.y };
}

function pointOn(frame, along = 0, side = 0, width = 1, lift = 0.18) {
  const x = frame.p.x + frame.t.x * along + frame.n.x * side * width;
  const z = frame.p.z + frame.t.z * along + frame.n.z * side * width;
  const y = Math.max(frame.y, groundHeight(x, z)) + lift;
  return new THREE.Vector3(x, y, z);
}

function makeGeometryFromPolygon(points, center) {
  const positions = [];
  const uvs = [];
  const indices = [];

  // 顶点 0 为中心，后面是轮廓点，fan triangulation。Junction 第一版足够稳定。
  positions.push(center.x, center.y, center.z);
  uvs.push(0.5, 0.5);

  let maxR = 1;
  for (const p of points) maxR = Math.max(maxR, Math.hypot(p.x - center.x, p.z - center.z));

  for (const p of points) {
    positions.push(p.x, p.y, p.z);
    uvs.push(0.5 + (p.x - center.x) / (maxR * 2.2), 0.5 + (p.z - center.z) / (maxR * 2.2));
  }

  for (let i = 1; i <= points.length; i++) {
    const a = i;
    const b = i === points.length ? 1 : i + 1;
    indices.push(0, a, b);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function makeEllipseDecal(center, tangent, material, rx, rz, lift = 0.22) {
  const geo = new THREE.CircleGeometry(1, 72);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(center.x, center.y + lift, center.z);
  mesh.rotation.y = Math.atan2(tangent.x, tangent.z);
  mesh.scale.set(rx, 1, rz);
  mesh.renderOrder = 5;
  return mesh;
}

function buildFlaredJunction({ mainIdx, branchIdx, branchForward }) {
  const main = getMainFrame(mainIdx);
  const branch = getBranchFrame(branchIdx, branchForward);

  // 支线离开路口方向。branchForward=1 表示从 A 端向支线内部走，-1 表示从 B 端反向向支线内部走。
  const branchAway = branch.t.clone();
  const mainT = main.t.clone();

  // 路口中心略取主/支路中心平均，减少两条路面高差导致的切口。
  const c = new THREE.Vector3(
    (main.p.x + branch.p.x) * 0.5,
    Math.max(main.p.y, branch.p.y) + 0.22,
    (main.p.z + branch.p.z) * 0.5
  );

  // 主路沿线前后截面，宽度比主路略大，覆盖车道线端点。
  const mainBack = getMainFrame(mainIdx - 18);
  const mainFwd = getMainFrame(mainIdx + 18);

  // 支路喇叭口远端，宽度比支路略大，形成真实汇入面积。
  const bStep = branchForward > 0 ? 34 : bSamples.length - 1 - 34;
  const branchFar = getBranchFrame(bStep, branchForward);

  const mainW = HALF_W + 1.6;
  const branchMouthW = B_HALF + 5.2;
  const branchFarW = B_HALF + 1.6;

  // 构建一个非圆形的道路汇入口多边形：主路长边 + 支路宽口。
  // 点序顺时针/逆时针不依赖方向，因为 side=DoubleSide；fan 三角化即可。
  const outline = [
    pointOn(mainBack, 0, -1, mainW),
    pointOn(mainFwd, 0, -1, mainW),
    pointOn(mainFwd, 0,  1, mainW),

    // 主路右侧向支路右侧过渡
    pointOn(branch, 10,  1, branchMouthW),
    pointOn(branchFar, 0,  1, branchFarW),
    pointOn(branchFar, 0, -1, branchFarW),
    pointOn(branch, 10, -1, branchMouthW),

    // 回到主路左侧
    pointOn(mainBack, 0,  1, mainW),
  ];

  const center = new THREE.Vector3(c.x, c.y, c.z);
  for (const p of outline) center.y = Math.max(center.y, p.y + 0.02);

  const mesh = new THREE.Mesh(makeGeometryFromPolygon(outline, center), makeJunctionMaterial());
  mesh.name = 'flared-junction-mesh';
  mesh.renderOrder = 4;
  mesh.receiveShadow = true;

  // 柔边污渍不是主补丁，只负责弱化边缘和材质突变。
  const dirt = makeEllipseDecal(center, branchAway.clone().add(mainT).normalize(), makeBlendMaterial({ color: 0x46382d, opacity: 0.18 }), 28, 16, 0.04);
  dirt.name = 'junction-soft-dirt-edge';

  const wear = makeEllipseDecal(center, branchAway.clone().add(mainT).normalize(), makeBlendMaterial({ color: 0x0b0c0e, opacity: 0.10 }), 18, 8, 0.06);
  wear.name = 'junction-tire-wear-softener';

  return { mesh, dirt, wear };
}

export function buildRoadJunctionPass() {
  // PR1 stop-loss: flared junction geometry (commit 038581e) produces a large
  // black block at the junction. Disable this pass entirely (no-op) until the
  // road surface mask system replaces it. Original implementation kept below
  // for rollback — do NOT delete.
  console.log('[ROAD] junction pass disabled: switching to road surface mask system');
  return;

  if (built || !samples?.length || !bSamples?.length) return;
  built = true;

  const group = new THREE.Group();
  group.name = 'P1_FlaredJunctionGeometryPass';

  const junctions = [
    buildFlaredJunction({ mainIdx: BRANCH_A, branchIdx: 0, branchForward: 1 }),
    buildFlaredJunction({ mainIdx: BRANCH_B, branchIdx: bSamples.length - 1, branchForward: -1 })
  ];

  for (const j of junctions) {
    group.add(j.dirt);
    group.add(j.mesh);
    group.add(j.wear);
  }

  scene.add(group);
  console.log('[ROAD] flared junction geometry pass built:', junctions.length, 'junctions');
}
