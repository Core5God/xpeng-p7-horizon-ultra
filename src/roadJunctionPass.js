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

// ---------- P0 Road Junction Overlay Pass ----------
// 目的：低风险修复支路汇入主路处的黑色断面、贴图断裂、车道线穿插和路肩硬切。
// 策略：不重写 world.js 道路网格；在 buildRoad() 后叠加 feathered decals：
// 1) junction asphalt cover：遮住断裂、车道线冲突和主/支路拼缝
// 2) dirt/gravel halo：做路肩到地形的软过渡
// 3) subtle tire-wear patch：让路口像被车辆压实的汇入区，而不是硬补丁

let built = false;

function radialTexture({ inner = 0.35, outer = 1.0, hard = 0.0, color = [255, 255, 255] } = {}) {
  const size = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const cx = size / 2;
  const cy = size / 2;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, cx);
  const [r, g2, b] = color;
  g.addColorStop(0, `rgba(${r},${g2},${b},1)`);
  g.addColorStop(Math.max(0.001, inner - hard), `rgba(${r},${g2},${b},1)`);
  g.addColorStop(inner, `rgba(${r},${g2},${b},0.92)`);
  g.addColorStop(outer, `rgba(${r},${g2},${b},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  // 轻噪声：避免补片像完美圆形 UI 贴纸
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = 0.86 + Math.random() * 0.18;
    img.data[i + 3] = Math.min(255, Math.max(0, img.data[i + 3] * n));
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

function roadNoiseTexture() {
  const size = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#202226';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 2600; i++) {
    const v = 22 + Math.random() * 38;
    const a = 0.06 + Math.random() * 0.16;
    ctx.fillStyle = `rgba(${v},${v},${v},${a})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  for (let i = 0; i < 22; i++) {
    const y = Math.random() * size;
    ctx.strokeStyle = `rgba(255,255,255,${0.015 + Math.random() * 0.025})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(size * 0.35, y + (Math.random() - 0.5) * 20, size * 0.65, y + (Math.random() - 0.5) * 20, size, y + (Math.random() - 0.5) * 18);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2.5, 2.5);
  tex.anisotropy = 4;
  return tex;
}

function makeDecalMaterial({ color, opacity, map, alphaMap, roughness = 0.95 }) {
  const mat = new THREE.MeshStandardMaterial({
    color,
    map,
    alphaMap,
    transparent: true,
    opacity,
    roughness,
    metalness: 0.0,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
    side: THREE.DoubleSide
  });
  mat.envMapIntensity = 0.12;
  return mat;
}

function makePlane(radius, segments = 72) {
  const geo = new THREE.CircleGeometry(radius, segments);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function placePatch({ group, p, tangent, normal, radius, scaleX, scaleZ, yLift, material, rotExtra = 0 }) {
  const mesh = new THREE.Mesh(makePlane(radius), material);
  const yaw = Math.atan2(tangent.x, tangent.z) + rotExtra;
  mesh.position.set(p.x, p.y + yLift, p.z);
  mesh.rotation.y = yaw;
  mesh.scale.set(scaleX, 1, scaleZ);
  mesh.renderOrder = 3;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function buildJunctionPoint(mainIdx, branchIdx, branchForward = 1) {
  const main = samples[mainIdx];
  const mainN = normals[mainIdx];
  const branch = bSamples[branchIdx];
  const branchN = bNormals[branchIdx];

  const tangentMain = new THREE.Vector3(mainN.z, 0, -mainN.x).normalize();
  const tangentBranch = new THREE.Vector3(branchN.z, 0, -branchN.x).multiplyScalar(branchForward).normalize();

  const p = new THREE.Vector3(
    (main.x + branch.x) * 0.5,
    Math.max(main.y, branch.y, groundHeight((main.x + branch.x) * 0.5, (main.z + branch.z) * 0.5)) + 0.06,
    (main.z + branch.z) * 0.5
  );

  // 用主路和支路方向平均，得到路口覆盖补片长轴
  const tangent = tangentMain.clone().add(tangentBranch).normalize();
  if (tangent.lengthSq() < 0.1) tangent.copy(tangentMain);

  return { p, tangent, mainN, branchN };
}

export function buildRoadJunctionPass() {
  if (built || !samples?.length || !bSamples?.length) return;
  built = true;

  const group = new THREE.Group();
  group.name = 'P0_RoadJunctionOverlayPass';

  const asphaltAlpha = radialTexture({ inner: 0.48, outer: 1.0, hard: 0.12 });
  const dirtAlpha = radialTexture({ inner: 0.38, outer: 1.0, hard: 0.02 });
  const wearAlpha = radialTexture({ inner: 0.24, outer: 0.92, hard: 0.02 });
  const asphaltNoise = roadNoiseTexture();

  const asphaltMat = makeDecalMaterial({
    color: 0x1d1f23,
    opacity: 0.88,
    map: asphaltNoise,
    alphaMap: asphaltAlpha,
    roughness: 0.92
  });
  const dirtMat = makeDecalMaterial({
    color: 0x4a3d2f,
    opacity: 0.34,
    alphaMap: dirtAlpha,
    roughness: 1.0
  });
  const wearMat = makeDecalMaterial({
    color: 0x0f1012,
    opacity: 0.20,
    alphaMap: wearAlpha,
    roughness: 0.98
  });

  const endA = buildJunctionPoint(BRANCH_A, 0, 1);
  const endB = buildJunctionPoint(BRANCH_B, bSamples.length - 1, -1);
  const points = [endA, endB];

  for (const j of points) {
    // 外圈泥土/碎石过渡：覆盖路肩硬切和地形裸边
    placePatch({
      group,
      p: j.p,
      tangent: j.tangent,
      normal: j.mainN,
      radius: HALF_W + B_HALF + 15,
      scaleX: 1.18,
      scaleZ: 0.72,
      yLift: 0.105,
      material: dirtMat,
      rotExtra: Math.PI * 0.02
    });

    // 沥青汇入区：盖住主/支路拼缝、分叉贴图断裂、车道线穿插
    placePatch({
      group,
      p: j.p,
      tangent: j.tangent,
      normal: j.mainN,
      radius: HALF_W + B_HALF + 8,
      scaleX: 1.05,
      scaleZ: 0.56,
      yLift: 0.135,
      material: asphaltMat
    });

    // 轮胎压实暗斑：让路口更像自然汇入，而不是纯几何补丁
    placePatch({
      group,
      p: j.p,
      tangent: j.tangent,
      normal: j.mainN,
      radius: HALF_W + B_HALF + 3,
      scaleX: 1.06,
      scaleZ: 0.36,
      yLift: 0.155,
      material: wearMat,
      rotExtra: -Math.PI * 0.015
    });
  }

  scene.add(group);
  console.log('[ROAD] junction overlay pass built:', points.length, 'junctions');
}
