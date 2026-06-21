import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { G, scene, renderer, sun, hemi, rim, sunDir, bloomPass, BLOOM_LAYER, FASTDEBUG } from './core.js';
import { generateForestSpots } from './vegetation/forestPatches.js';
import { buildGrassLayer } from './vegetation/grassLayer.js';
import { buildRoadsideEcology } from './vegetation/roadsideScatter.js';
import { createRoadSurfaceMasks, maybeShowRoadMaskDebug } from './roadSurfaceMask.js';

// ---------- 天空（官方大气散射：瑞利/米氏） ----------
const sky = new Sky();
sky.scale.setScalar(3000);
scene.add(sky);
const skyU = sky.material.uniforms;

// 星空（夜间）
const stars = (() => {
  const N = 1400, pos = new Float32Array(N*3);
  for (let i = 0; i < N; i++) {
    const a = Math.random()*Math.PI*2, e = Math.acos(Math.random()*0.95); // 上半球
    const r = 2500;
    pos[i*3] = Math.cos(a)*Math.sin(e)*r;
    pos[i*3+1] = Math.cos(e)*r*0.95 + 80;
    pos[i*3+2] = Math.sin(a)*Math.sin(e)*r;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({color:0xcfd8ff, size:2.2, sizeAttenuation:false, transparent:true, opacity:0.9, fog:false, depthWrite:false});
  const p = new THREE.Points(g, m);
  p.visible = false;
  scene.add(p);
  return p;
})();

// 环境反射（由天空生成，可重建）
export const windU = { value: 0 }; // 叶片风摆时间（main 每帧更新）
let pmremTex = null;
const envGroundMat = new THREE.MeshBasicMaterial({color:0x4a4038});
function rebuildEnv() {
  const pmrem = new THREE.PMREMGenerator(renderer);
  // 反射环境 = 天空 + 暗色地面：下半球反射不再是亮天，车漆质感更真实
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(sky.geometry, sky.material));
  envGroundMat.color.setHex(G.curTod === 'night' ? 0x0a0e13 : G.curTod === 'day' ? 0x46553f : 0x4a4038);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(900, 24), envGroundMat);
  ground.rotation.x = -Math.PI/2;
  ground.position.y = -2;
  envScene.add(ground);
  // 大模糊 sigma：太阳盘会把整个立方体贴图面打饱和，平整车身板会反射出"正方形"高光；
  // 模糊后环境只提供柔和的天光/地光，锐利的太阳高光交给方向光（圆形、物理正确）
  const rt = pmrem.fromScene(envScene, 0.55);
  if (pmremTex) pmremTex.dispose();
  pmremTex = rt.texture;
  scene.environment = pmremTex;
  pmrem.dispose();
}

// ---------- 白天 HDRI 天空（Poly Haven，真实天光与反射；其余时段仍用程序化大气散射） ----------
let dayBg = null, dayEnv = null, hdrReady = false;
new RGBELoader().load('assets/sky_day.hdr', (tex) => {
  tex.mapping = THREE.EquirectangularReflectionMapping;
  dayBg = tex; // 背景仍用完整天空
  // 反射环境 = HDRI 天空 + 暗色地面：纯天空 HDRI 没有地面，会让车身上下都反射亮天 → 发"平/塑料"；
  // 补一块暗地面盖住下半球，车漆才有"上亮天、下暗地"的金属反射梯度（产品级渲染惯用手法）。
  const pm = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.background = tex;
  const grd = new THREE.Mesh(new THREE.CircleGeometry(3000, 32), new THREE.MeshBasicMaterial({ color: 0x4a453c }));
  grd.rotation.x = -Math.PI / 2;
  grd.position.y = -2;
  envScene.add(grd);
  dayEnv = pm.fromScene(envScene, 0.06, 0.1, 12000).texture; // 轻微模糊：反射有云形与地平线但不噪
  pm.dispose();
  hdrReady = true;
  if (G.curTod === 'day') applySkyForTod(); // 当前就是白天则立即生效
}, undefined, (e) => console.warn('白天 HDRI 加载失败，回退程序化天空：', e));

// 按当前时段选择天空/环境：白天用 HDRI（背景+IBL，隐藏程序化天空盒），落日/夜晚用程序化
function applySkyForTod() {
  if (G.weatherOn) return; // 动态天气由 skycycle.js 全权管理
  if (G.curTod === 'day' && hdrReady) {
    sky.visible = false;
    scene.background = dayBg;
    scene.environment = dayEnv;
  } else {
    sky.visible = true;
    scene.background = null;
    rebuildEnv();
  }
}

// ---------- 时间预设 ----------
const PRESETS = {
  sunset: {
    label:'落日', sunDir:[-0.55,0.30,-0.81], sunCol:0xffc792, sunInt:9, hemiInt:1.3, hemiSky:0xffd9b0,
    exposure:0.62, fog:0xcf7a72, skySun:[-0.55,0.03,-0.81], turbidity:10, rayleigh:3.2, mieC:0.0015, mieG:0.985,
    water:0x06283a, bloom:0.24, lights:false
  },
  day: {
    label:'白天', sunDir:[-0.45,0.78,-0.45], sunCol:0xfff2dd, sunInt:7.2, hemiInt:1.1, hemiSky:0xcfe5ff,
    exposure:0.5, fog:0x9fc3dc, skySun:[-0.45,0.55,-0.45], turbidity:2.4, rayleigh:1.9, mieC:0.0012, mieG:0.95,
    water:0x0d4a66, bloom:0.12, lights:false
  },
  night: {
    label:'夜晚', sunDir:[0.45,0.55,0.55], sunCol:0xa8bcdc, sunInt:1.4, hemiInt:0.45, hemiSky:0x223355,
    exposure:1.15, fog:0x0a1020, skySun:[0.45,-0.28,0.55], turbidity:2, rayleigh:1.0, mieC:0.002, mieG:0.7,
    water:0x021018, bloom:0.6, lights:true
  }
};
const curSunDir = sunDir.clone();

// ---------- 赛道曲线 ----------
// 道路 XZ 走向由控制点决定，高度贴合地形（draping）：路铺在地面上、不再悬浮。
// 贴地查询已是三角面精确插值，故无需把路架高来躲网格误差。
// （islandBase/hills 为函数声明，已提升，可在此安全调用）
const ctrl = [];
for (let i = 0; i < 12; i++) {
  const a = i/12 * Math.PI*2;
  const r = 310 + 100*Math.sin(a*2.3+1.0) + 55*Math.sin(a*3.7+0.3);
  const cx = Math.cos(a)*r, cz = Math.sin(a)*r;
  ctrl.push(new THREE.Vector3(cx, Math.max(islandBase(cx, cz), 1.0), cz));
}
const curve = new THREE.CatmullRomCurve3(ctrl, true, 'catmullrom', 0.55);
const NS = 800, samples = [], tangents = [], normals = [];
for (let i = 0; i < NS; i++) {
  const t = i/NS;
  const p = curve.getPointAt(t);
  p.y = islandBase(p.x, p.z); // 采样点高度取地形
  samples.push(p);
  const tg = curve.getTangentAt(t);
  tangents.push(tg);
  normals.push(new THREE.Vector3(-tg.z, 0, tg.x).normalize());
}
// 沿环线平滑路面高度：滤掉地形高频颠簸，保留大尺度坡道（可顺畅驾驶）
{
  const W = 8, ys = samples.map(s => s.y);
  for (let i = 0; i < NS; i++) {
    let acc = 0;
    for (let k = -W; k <= W; k++) acc += ys[(i + k + NS) % NS];
    samples[i].y = Math.max(acc / (2*W + 1), 0.8);
  }
}
const HALF_W = 6.2;

// 选最平整的路段作为车库展示位（避免斜坡穿帮）
let garageIdx = 0;
{
  let best = 1e9;
  for (let i = 0; i < NS; i += 5) {
    let v = 0;
    for (const k of [-15, -8, 8, 15]) v += Math.abs(samples[(i+k+NS)%NS].y - samples[i].y);
    if (v < best) { best = v; garageIdx = i; }
  }
}

function nearestRoad(x, z) {
  let best = 1e18, bi = 0;
  for (let i = 0; i < NS; i += 4) {
    const dx = samples[i].x - x, dz = samples[i].z - z;
    const d = dx*dx + dz*dz;
    if (d < best) { best = d; bi = i; }
  }
  for (let j = bi-4; j <= bi+4; j++) {
    const i = (j+NS) % NS;
    const dx = samples[i].x - x, dz = samples[i].z - z;
    const d = dx*dx + dz*dz;
    if (d < best) { best = d; bi = i; }
  }
  return { idx: bi, dist: Math.sqrt(best) };
}

// ---------- 地形 ----------
function hills(x, z) {
  return Math.sin(x*0.010)*Math.cos(z*0.013)*10
       + Math.sin(x*0.027+1.7)*Math.cos(z*0.022+0.6)*5
       + Math.sin(x*0.0048-0.4)*Math.cos(z*0.0041+2.1)*16 + 8;
}
function islandBase(x, z) {
  const d = Math.sqrt(x*x + z*z);
  let h = hills(x, z);
  const fall = 1 - THREE.MathUtils.smoothstep(d, 520, 760);
  h = h*fall - Math.max(0, d-640)*0.09 - (1-fall)*6;
  if (d < 520) h = Math.max(h, 0.8);
  return h;
}
// 地形网格分辨率：buildTerrain 与 meshGroundHeight 必须共用同一组常量（否则碰撞高度场错位）
const TERR_SEG = 300, TERR_SIZE = 1900, TERR_HALF = 950, TERR_ST = TERR_SIZE / TERR_SEG;
// 中频起伏细节：让地表丰富、不像平面（仅叠加在路外地形上；路面走廊仍由压平带保持平整）
function detail(x, z) {
  return Math.sin(x*0.075 + z*0.05)*1.4 + Math.sin(x*0.12 - z*0.10)*0.9 + Math.sin(x*0.26 + z*0.21)*0.45;
}
// 路面高度沿路段插值（消除逐采样点的台阶抖动）
function roadYAt(x, z, idx) {
  const a = samples[idx];
  for (const j of [(idx+1)%NS, (idx-1+NS)%NS]) {
    const b = samples[j];
    const abx = b.x - a.x, abz = b.z - a.z;
    const L2 = abx*abx + abz*abz;
    if (L2 < 1e-6) continue;
    const t = ((x-a.x)*abx + (z-a.z)*abz) / L2;
    if (t > 0 && t <= 1) return a.y + (b.y - a.y)*t;
  }
  return a.y;
}
function groundHeight(x, z) {
  const nr = nearestRoad(x, z);
  let dRoad = nr.dist;
  let ry = roadYAt(x, z, nr.idx);
  // 支线也压平地形；桥段除外（地形从桥下穿过）
  if (typeof bSamples !== 'undefined' && bSamples.length) {
    const bi = branchInfo(x, z);
    if (!bi.bridge && bi.dist < dRoad) { dRoad = bi.dist; ry = bi.y; }
  }
  const base = islandBase(x, z) + detail(x, z); // 叠加中频起伏，地表更丰富
  // 压平带 15m：保证地形网格在路两侧必有顶点被压平，杜绝顶点间插值隆起盖住路面
  if (dRoad < 15) return ry - 0.05;
  if (dRoad < 60) {
    const t = THREE.MathUtils.smoothstep(dRoad, 15, 60);
    return (ry - 0.05)*(1-t) + base*t;
  }
  return base;
}
// ---------- 支线公路与跨谷桥 ----------
const B_HALF = 5.0;
const BRANCH_A = 120, BRANCH_B = 480; // 支线汇入主路的采样位置（护栏/道具让位用）
const bSamples = [], bTangents = [], bNormals = [], bBridge = [];
{
  const A = BRANCH_A, B = BRANCH_B;
  const pa = samples[A].clone(), pb = samples[B].clone();
  const mids = [];
  for (const t of [0.3, 0.5, 0.7]) {
    const m = new THREE.Vector3().lerpVectors(pa, pb, t);
    m.x += Math.sin(t*9)*22;
    m.z += Math.cos(t*7)*18;
    const hb = islandBase(m.x, m.z);
    m.y = Math.max(hb + 1.2, Math.min(pa.y, pb.y)); // 平缓走线：低谷自动成桥、山体自动成路堑
    mids.push(m);
  }
  const a2 = pa.clone().addScaledVector(tangents[A], 26);
  const b2 = pb.clone().addScaledVector(tangents[B], -26);
  const bc = new THREE.CatmullRomCurve3([pa, a2, ...mids, b2, pb], false, 'catmullrom', 0.4);
  const NB = 260;
  // 支线同样贴合地形（draping）：不再架设跨谷桥——桥的纸片侧裙、塌陷接坡、
  // 碰撞与视觉不一致导致"车开到地面以下"等问题，统一改为贴地内陆公路根除。
  for (let i = 0; i <= NB; i++) {
    const t = i/NB;
    const p = bc.getPointAt(t);
    const tg = bc.getTangentAt(t);
    p.y = Math.max(islandBase(p.x, p.z), 1.0); // 高度取地形
    bSamples.push(p);
    bTangents.push(tg);
    bNormals.push(new THREE.Vector3(-tg.z, 0, tg.x).normalize());
  }
  // 纵坡低通平滑 + 两端对齐主路汇入高度（消除接缝）
  {
    const W = 6, ys = bSamples.map(s => s.y);
    for (let i = 0; i <= NB; i++) {
      let acc = 0, n = 0;
      for (let k = -W; k <= W; k++) { const j = i + k; if (j >= 0 && j <= NB) { acc += ys[j]; n++; } }
      bSamples[i].y = acc / n;
    }
    const blend = 14;
    for (let i = 0; i <= blend; i++) {
      const w = i / blend;
      bSamples[i].y = pa.y * (1 - w) + bSamples[i].y * w;
      bSamples[NB - i].y = pb.y * (1 - w) + bSamples[NB - i].y * w;
    }
  }
  for (let i = 0; i <= NB; i++) bBridge.push(false); // 全程贴地，无桥段
}
function branchInfo(x, z) {
  let best = 1e18, bi = 0;
  for (let i = 0; i < bSamples.length; i += 3) {
    const dx = bSamples[i].x - x, dz = bSamples[i].z - z;
    const d = dx*dx + dz*dz;
    if (d < best) { best = d; bi = i; }
  }
  for (let j = Math.max(0, bi-3); j <= Math.min(bSamples.length-1, bi+3); j++) {
    const dx = bSamples[j].x - x, dz = bSamples[j].z - z;
    const d = dx*dx + dz*dz;
    if (d < best) { best = d; bi = j; }
  }
  let y = bSamples[bi].y;
  for (const j of [bi+1, bi-1]) {
    if (j < 0 || j >= bSamples.length) continue;
    const a = bSamples[bi], b = bSamples[j];
    const abx = b.x - a.x, abz = b.z - a.z;
    const L2 = abx*abx + abz*abz;
    if (L2 < 1e-6) continue;
    const t = ((x-a.x)*abx + (z-a.z)*abz) / L2;
    if (t > 0 && t <= 1) { y = a.y + (b.y - a.y)*t; break; }
  }
  return { dist: Math.sqrt(best), y, bridge: bBridge[bi], idx: bi };
}

// 地形网格高度场：与渲染出的低面数地形严格一致（越野贴地用）
let terrainField = null;
function meshGroundHeight(x, z) {
  if (!terrainField) return groundHeight(x, z);
  const g = TERR_SEG + 1, st = TERR_ST;
  const gx = (x + TERR_HALF)/st, gz = (z + TERR_HALF)/st;
  if (gx < 0 || gz < 0 || gx >= TERR_SEG || gz >= TERR_SEG) return groundHeight(x, z);
  const ix = Math.floor(gx), iz = Math.floor(gz);
  const u = gx - ix, v = gz - iz;
  const h00 = terrainField[iz*g+ix], h10 = terrainField[iz*g+ix+1];
  const h01 = terrainField[(iz+1)*g+ix], h11 = terrainField[(iz+1)*g+ix+1];
  // 三角面精确插值：与 PlaneGeometry 实际三角剖分一致（对角线 (ix,iz+1)-(ix+1,iz)），
  // 取代双线性——双线性与渲染三角面在起伏处可差 ~0.5m，正是"车陷进土里"的根因。
  // 对角线 u+v=1：左下三角(含 h00) / 右上三角(含 h11)
  if (u + v <= 1) return h00 + u*(h10 - h00) + v*(h01 - h00);
  return h11 + (1 - u)*(h01 - h11) + (1 - v)*(h10 - h11);
}

// 车辆贴地用的"可行驶表面"高度：主路/支线/桥面取路面顶面，路外取渲染地形
// refY：车辆当前高度——在桥下方时取桥下地形而非被"吸"上桥面
function surfaceHeight(x, z, refY) {
  const nr = nearestRoad(x, z);
  let mainY = null;
  if (nr.dist < HALF_W) mainY = roadYAt(x, z, nr.idx) + 0.06;
  else if (nr.dist < HALF_W + 1.1) mainY = roadYAt(x, z, nr.idx) + 0.04;
  let brY = null, biDist = 1e9;
  if (bSamples.length) {
    const bi = branchInfo(x, z);
    biDist = bi.dist;
    const underBridge = bi.bridge && refY !== undefined && refY < bi.y - 2;
    if (!underBridge) {
      if (bi.dist < B_HALF) brY = bi.y + 0.07;
      else if (bi.dist < B_HALF + 1.1 && !bi.bridge) brY = bi.y + 0.04;
    }
  }
  if (mainY !== null && brY !== null) {
    // 双路重叠区（汇入口/并行段）：
    // 1. 两面都贴近车高 → 按平面距离稳定取面（避免逐帧翻转造成"路面瞬移"）
    // 2. 否则取与车辆当前高度更接近的面（杜绝错位路面间瞬移攀爬）
    if (refY === undefined) return Math.max(mainY, brY);
    const dm = Math.abs(mainY - refY), db = Math.abs(brY - refY);
    if (dm < 0.45 && db < 0.45) return nr.dist <= biDist ? mainY : brY;
    return dm <= db ? mainY : brY;
  }
  if (brY !== null) return brY;
  if (mainY !== null) return mainY;
  return meshGroundHeight(x, z);
}

// —— 多八度值噪声场（细节贴图生成用）
function makeNoiseField(size, octs) {
  const f = new Float32Array(size*size);
  for (const [cells, amp] of octs) {
    const grid = new Float32Array((cells+1)*(cells+1));
    for (let i = 0; i < grid.length; i++) grid[i] = Math.random();
    const cs = size/cells;
    for (let y = 0; y < size; y++) {
      const gy = y/cs, iy = Math.floor(gy)%cells, fy = gy-Math.floor(gy);
      const sy = fy*fy*(3-2*fy);
      for (let x = 0; x < size; x++) {
        const gx = x/cs, ix = Math.floor(gx)%cells, fx = gx-Math.floor(gx);
        const sx = fx*fx*(3-2*fx);
        const a = grid[iy*(cells+1)+ix], b = grid[iy*(cells+1)+ix+1];
        const c = grid[(iy+1)*(cells+1)+ix], d = grid[(iy+1)*(cells+1)+ix+1];
        f[y*size+x] += amp * ((a*(1-sx)+b*sx)*(1-sy) + (c*(1-sx)+d*sx)*sy);
      }
    }
  }
  return f;
}
function fieldToTex(size, fn, post) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const x = cv.getContext('2d');
  const img = x.createImageData(size, size);
  fn(img.data, size);
  x.putImageData(img, 0, 0);
  if (post) post(x, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function terrainGrassTex() {
  const S = 512, f = makeNoiseField(S, [[12,0.45],[36,0.3],[110,0.25]]);
  return fieldToTex(S, (d, s) => {
    for (let i = 0; i < s*s; i++) {
      const v = 0.68 + f[i]*0.34;
      d[i*4] = 255*v*0.92; d[i*4+1] = 255*v*1.0; d[i*4+2] = 255*v*0.85; d[i*4+3] = 255;
    }
  }, (x, s) => { // 深色草斑
    x.fillStyle = 'rgba(30,52,28,0.25)';
    for (let k = 0; k < 900; k++) {
      x.beginPath();
      x.ellipse(Math.random()*s, Math.random()*s, 1 + Math.random()*2.4, 0.8 + Math.random()*1.4, Math.random()*3, 0, 7);
      x.fill();
    }
  });
}
function terrainSandTex() {
  const S = 512, f = makeNoiseField(S, [[16,0.35],[90,0.4],[200,0.25]]);
  const low = makeNoiseField(S, [[6,1]]);
  return fieldToTex(S, (d, s) => {
    for (let i = 0; i < s*s; i++) {
      const x2 = i % s;
      const ripple = 0.93 + 0.07*Math.sin((x2 + low[i]*60) * 0.16); // 风纹
      const v = (0.74 + f[i]*0.3) * ripple;
      d[i*4] = 255*v*1.04; d[i*4+1] = 255*v*0.97; d[i*4+2] = 255*v*0.82; d[i*4+3] = 255;
    }
  });
}
function terrainRockTex() {
  const S = 512, f = makeNoiseField(S, [[10,0.5],[40,0.3],[140,0.2]]);
  return fieldToTex(S, (d, s) => {
    for (let i = 0; i < s*s; i++) {
      const raw = f[i];
      const v = raw < 0.5 ? 0.55 + raw*0.5 : 0.62 + raw*0.55; // 提高对比
      d[i*4] = 255*v*0.97; d[i*4+1] = 255*v*0.95; d[i*4+2] = 255*v*0.92; d[i*4+3] = 255;
    }
  }, (x, s) => { // 裂缝
    x.strokeStyle = 'rgba(25,22,20,0.35)';
    x.lineWidth = 1.2;
    for (let k = 0; k < 70; k++) {
      x.beginPath();
      let px2 = Math.random()*s, py2 = Math.random()*s;
      x.moveTo(px2, py2);
      for (let j = 0; j < 4; j++) {
        px2 += (Math.random()-0.5)*40; py2 += (Math.random()-0.5)*40;
        x.lineTo(px2, py2);
      }
      x.stroke();
    }
  });
}

// —— 植物剪影贴图（alpha 镂空，消除"纸片感"）
function plantTex(draw) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const x = cv.getContext('2d');
  x.clearRect(0, 0, 64, 64);
  draw(x);
  const t2 = new THREE.CanvasTexture(cv);
  t2.colorSpace = THREE.SRGBColorSpace;
  return t2;
}
function bladeTexture() {
  return plantTex((x) => {
    x.fillStyle = '#fff';
    for (let k = 0; k < 7; k++) {
      const bx = 8 + k*7 + Math.random()*4;
      const h2 = 28 + Math.random()*30;
      const lean = (Math.random()-0.5)*10;
      x.beginPath();
      x.moveTo(bx - 2.2, 64);
      x.quadraticCurveTo(bx + lean*0.4, 64 - h2*0.6, bx + lean, 64 - h2);
      x.quadraticCurveTo(bx + lean*0.4 + 1.5, 64 - h2*0.6, bx + 2.2, 64);
      x.fill();
    }
  });
}
function flowerTexture() {
  return plantTex((x) => {
    for (let k = 0; k < 5; k++) {
      const cx2 = 12 + Math.random()*40, cy2 = 12 + Math.random()*34;
      x.fillStyle = '#fff';
      for (let p2 = 0; p2 < 5; p2++) {
        const a = p2/5*Math.PI*2;
        x.beginPath();
        x.ellipse(cx2 + Math.cos(a)*4, cy2 + Math.sin(a)*4, 3.4, 2.2, a, 0, 7);
        x.fill();
      }
      x.fillStyle = '#999';
      x.beginPath(); x.arc(cx2, cy2, 2, 0, 7); x.fill();
      x.fillStyle = '#fff';
      x.fillRect(cx2 - 0.8, cy2, 1.6, 64 - cy2); // 茎
    }
  });
}
function reedTexture() {
  return plantTex((x) => {
    x.fillStyle = '#fff';
    for (let k = 0; k < 5; k++) {
      const bx = 8 + k*11 + Math.random()*4;
      const lean = (Math.random()-0.5)*8;
      x.beginPath();
      x.moveTo(bx - 1.6, 64);
      x.lineTo(bx + lean - 0.5, 4 + Math.random()*8);
      x.lineTo(bx + lean + 0.9, 4 + Math.random()*8);
      x.lineTo(bx + 1.6, 64);
      x.fill();
    }
  });
}

function buildTerrain() {
  const SEG = TERR_SEG, SIZE = TERR_SIZE;
  const g = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  g.rotateX(-Math.PI/2);
  const pos = g.attributes.position;
  const colors = new Float32Array(pos.count*3);
  const field = new Float32Array(pos.count);
  const cSand = new THREE.Color(0xd9c08c), cGrass = new THREE.Color(0x55784a),
        cDry = new THREE.Color(0x96995c), cRock = new THREE.Color(0x8d8278);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = groundHeight(x, z);
    pos.setY(i, h);
    if (h < 1.2) tmp.copy(cSand);
    else if (h < 4) tmp.copy(cSand).lerp(cGrass, (h-1.2)/2.8);
    else if (h < 16) tmp.copy(cGrass).lerp(cDry, (h-4)/12);
    else tmp.copy(cDry).lerp(cRock, Math.min((h-16)/10, 1));
    const v = 0.92 + 0.13*Math.sin(x*0.8)*Math.cos(z*0.7);
    colors[i*3] = tmp.r*v; colors[i*3+1] = tmp.g*v; colors[i*3+2] = tmp.b*v;
    field[i] = h; // 记录高度场（与渲染网格一致的越野贴地）
  }
  // —— 烘焙 AO（地平线遮蔽）：谷地/坡脚/凹处变暗，立体感；与时段无关、零每帧开销，写入顶点色
  {
    const gsz = SEG + 1, cell = SIZE / SEG;
    const DIRS = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]];
    const STEPS = [2, 5, 11];
    for (let i = 0; i < pos.count; i++) {
      const ix = i % gsz, iz = (i / gsz) | 0, h = field[i];
      let occ = 0;
      for (const [dx, dz] of DIRS) {
        let maxAng = 0;
        for (const s of STEPS) {
          const nx = ix + dx*s, nz = iz + dz*s;
          if (nx < 0 || nz < 0 || nx >= gsz || nz >= gsz) continue;
          const ang = (field[nz*gsz + nx] - h) / (s * cell); // 邻居更高=遮挡
          if (ang > maxAng) maxAng = ang;
        }
        occ += Math.min(maxAng, 1.0);
      }
      const ao = THREE.MathUtils.clamp(1.0 - (occ / DIRS.length) * 1.4, 0.5, 1.0);
      colors[i*3] *= ao; colors[i*3+1] *= ao; colors[i*3+2] *= ao;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  terrainField = field;
  g.computeVertexNormals();
  // —— PBR splat 地形：真实 diffuse + roughness 按高度/坡度混合（顶点算权重），森林地法线提供表面起伏
  const TL = new THREE.TextureLoader(), TP = 'assets/terrain/';
  const texColor = (u) => { const t = TL.load(u); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  const texData  = (u) => { const t = TL.load(u); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; };
  const sandD = texColor(TP+'sand_diff.jpg'), forestD = texColor(TP+'forest_diff.jpg'), rockD = texColor(TP+'rock_diff.jpg'), dryD = texColor(TP+'dry_diff.jpg');
  const sandR = texData(TP+'sand_rough.webp'), rockR = texData(TP+'rock_rough.webp'), dryR = texData(TP+'dry_rough.webp'), forestR = texData(TP+'forest_rough.webp');
  const forestN = texData(TP+'forest_nrm.webp');
  // —— Road surface masks (PR2/PR3): bake top-down asphalt/shoulder/junction/line and blend in terrain shader
  const roadMasks = createRoadSurfaceMasks({
    samples, bSamples,
    HALF_W, B_HALF, BRANCH_A, BRANCH_B,
    terrainSize: TERR_SIZE,
  });
  maybeShowRoadMaskDebug(roadMasks);
  const mat = new THREE.MeshStandardMaterial({ vertexColors:true, map: forestD, normalMap: forestN, roughnessMap: forestR, roughness:1.0, metalness:0, envMapIntensity:0.55 });
  mat.normalScale.set(1.0, 1.0); // 法线强度回到 1.0：保留凹凸但不至于在暗部糊成死黑
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tSandD = { value: sandD }; shader.uniforms.tRockD = { value: rockD }; shader.uniforms.tDryD = { value: dryD };
    shader.uniforms.tSandR = { value: sandR }; shader.uniforms.tRockR = { value: rockR }; shader.uniforms.tDryR = { value: dryR };
    shader.uniforms.uTile = { value: 320.0 }; // 平铺更密 → 贴图颗粒回到真实尺寸（~6m/铺），不再像被放大
    shader.uniforms.uAsphaltMask = { value: roadMasks.asphaltMask };
    shader.uniforms.uShoulderMask = { value: roadMasks.shoulderMask };
    shader.uniforms.uJunctionMask = { value: roadMasks.junctionMask };
    shader.uniforms.uLineMask = { value: roadMasks.lineMask };
    shader.uniforms.uTerrainSize = { value: TERR_SIZE };
    shader.vertexShader = 'varying vec4 vW;\nvarying vec3 vWorldPos;\n' + shader.vertexShader.replace('#include <begin_vertex>', [
      '#include <begin_vertex>',
      'vec4 wp = modelMatrix * vec4(position, 1.0);',
      'vWorldPos = wp.xyz;',
      'float H = position.y;',
      'float sl = 1.0 - clamp(normal.y, 0.0, 1.0);',                 // 坡度
      'float wSand = 1.0 - smoothstep(0.6, 3.0, H);',                // 低处海岸=沙
      'float wRock = clamp(smoothstep(14.0, 22.0, H) + smoothstep(0.42, 0.72, sl), 0.0, 1.0);', // 高处/陡坡=岩
      'float wDry  = smoothstep(3.5, 9.0, H) * (1.0 - smoothstep(15.0, 22.0, H));',             // 中段过渡=干裂地
      'vec4 w = vec4(wSand, 1.0, wRock, wDry);',                     // forest 作底
      'vW = w / (w.x + w.y + w.z + w.w);'
    ].join('\n'));
    shader.fragmentShader = 'uniform sampler2D tSandD,tRockD,tDryD,tSandR,tRockR,tDryR; uniform float uTile; uniform sampler2D uAsphaltMask,uShoulderMask,uJunctionMask,uLineMask; uniform float uTerrainSize; varying vec4 vW; varying vec3 vWorldPos;\n' + shader.fragmentShader
      .replace('#include <map_fragment>', [
        'vec2 uvT = vMapUv * uTile;',
        'vec3 dF = texture2D(map, uvT).rgb;',
        'vec3 dS = texture2D(tSandD, uvT).rgb;',
        'vec3 dR = texture2D(tRockD, uvT*0.6).rgb;',
        'vec3 dD = texture2D(tDryD, uvT).rgb;',
        // 宏观色带：大尺度噪声打破重复感（强化版）
        'float macro1 = sin(vWorldPos.x*0.008 + 1.3) * cos(vWorldPos.z*0.006 + 0.7) * 0.5 + 0.5;',
        'float macro2 = sin(vWorldPos.x*0.023 + 3.1) * sin(vWorldPos.z*0.019 + 2.4) * 0.5 + 0.5;',
        'float macro3 = cos(vWorldPos.x*0.047 + 0.5) * cos(vWorldPos.z*0.039 + 1.8) * 0.5 + 0.5;',
        'float macroVal = macro1 * 0.5 + macro2 * 0.3 + macro3 * 0.2;',
        'vec3 macroTint = mix(vec3(0.78, 0.85, 0.72), vec3(1.12, 1.06, 0.92), macroVal);',
        // 海岸线湿润暗化（加强）
        'float shoreH = smoothstep(4.0, 0.2, vWorldPos.y);',
        'vec3 shoreTint = mix(vec3(1.0), vec3(0.68, 0.75, 0.62), shoreH * 0.5);',
        // 路边绿色增强带
        'float roadDist = length(vWorldPos.xz);',
        // 中景植被暗化（假阴影）：森林/草甸区域地面明显暗化，模拟树冠遮蔽
        'float vegDark = smoothstep(2.5, 7.0, vWorldPos.y) * (1.0 - smoothstep(20.0, 28.0, vWorldPos.y));',
        'vegDark *= (1.0 - vW.z * 0.7);', // 岩石区域不需要暗化
        'float vegShadow = mix(1.0, 0.55, vegDark * 0.75);',
        'diffuseColor.rgb *= (dS*vW.x + dF*vW.y + dR*vW.z + dD*vW.w) * 1.1 * macroTint * shoreTint * vegShadow;',
        // —— Road surface mask blend: asphalt / shoulder / junction / lane lines
        'vec2 roadUv = vec2(vWorldPos.x + uTerrainSize*0.5, vWorldPos.z + uTerrainSize*0.5) / uTerrainSize;',
        'float asphaltM = texture2D(uAsphaltMask, roadUv).r;',
        'float shoulderM = clamp(texture2D(uShoulderMask, roadUv).r - asphaltM, 0.0, 1.0);',
        'float junctionM = texture2D(uJunctionMask, roadUv).r;',
        'vec2 lineRG = texture2D(uLineMask, roadUv).rg;',
        // 路口收线：junctionM>0.45 核心区 lineKeep=0 完全无线，0.12~0.45 软渐隐，<0.12 直路正常
        'float lineKeep = 1.0 - smoothstep(0.12, 0.45, junctionM);',
        'float yellowLine = lineRG.r * lineKeep;',
        'float whiteLine = lineRG.g * lineKeep;',
        'vec3 rsBase = diffuseColor.rgb;',
        'vec3 rsDirt = vec3(0.18, 0.16, 0.13);',
        'vec3 rsAsph = vec3(0.040, 0.043, 0.046);',
        'rsBase = mix(rsBase, rsDirt, shoulderM * 0.55);',
        'rsBase = mix(rsBase, rsAsph, asphaltM);',
        // —— 路口渐隐过渡：沥青 → 破损沥青 → 碎石（纯程序化，零新采样器，避免贴图采样器超限导致地面整体异常）
        'float decay = junctionM;',
        // 程序化破损/碎石纹理：复用 vWorldPos 多频噪声，无需新贴图
        'float gN1 = sin(vWorldPos.x*1.7 + 0.4) * cos(vWorldPos.z*1.9 + 1.1) * 0.5 + 0.5;',
        'float gN2 = sin(vWorldPos.x*4.3 + 2.7) * sin(vWorldPos.z*3.7 + 0.3) * 0.5 + 0.5;',
        'float gN = clamp(gN1*0.6 + gN2*0.4, 0.0, 1.0);',
        // 破损沥青：略亮、带颗粒；碎石：偏灰土黄、更高对比
        'vec3 crackCol  = rsAsph + vec3(0.030, 0.028, 0.024) * gN + vec3(0.012);',
        'vec3 gravelCol = mix(vec3(0.090, 0.084, 0.072), vec3(0.165, 0.150, 0.120), gN);',
        'float t1 = smoothstep(0.15, 0.55, decay);',
        'float t2 = smoothstep(0.55, 0.95, decay);',
        'vec3 roadSurf = rsAsph;',
        'roadSurf = mix(roadSurf, crackCol,  t1);',
        'roadSurf = mix(roadSurf, gravelCol, t2);',
        // 只在路面区域(asphaltM)按 decay 强度生效，绝不污染草地/沙地/岩石
        'rsBase = mix(rsBase, roadSurf, asphaltM * decay);',
        'rsBase = mix(rsBase, vec3(1.0, 0.85, 0.10), yellowLine * 0.95);',
        'rsBase = mix(rsBase, vec3(0.95, 0.95, 0.95), whiteLine * 0.95);',
        'diffuseColor.rgb = rsBase;'
      ].join('\n'))
      .replace('#include <roughnessmap_fragment>', [
        'float roughnessFactor = roughness;',
        'vec2 uvR = vMapUv * uTile;',
        'float rF = texture2D(roughnessMap, uvR).g;',
        'float rS = texture2D(tSandR, uvR).g;',
        'float rR = texture2D(tRockR, uvR*0.6).g;',
        'float rD = texture2D(tDryR, uvR).g;',
        'roughnessFactor *= (rS*vW.x + rF*vW.y + rR*vW.z + rD*vW.w);',
        // 破损/碎石区更粗糙不反光（仅路面 asphaltM*junctionM 生效）
        'roughnessFactor = mix(roughnessFactor, 0.95, asphaltM * junctionM);'
      ].join('\n'));
  };
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  scene.add(m);
}

// ---------- 海洋（三段式海岸着色：浅滩 → 深海 → 远海 horizon） ----------
// 弃用 Three.js Water 的实时平面反射——它每帧把整个场景重渲一遍做反射，而海面 98% 时间看不到，
// 性价比极差。改用自定义 shader：按距岛心距离分三段着色 + 法线波纹 + 环境反射。
const oceanUniforms = {
  normalMap: { value: null },
  normalScale: { value: 0.45 },
  normalOffset: { value: new THREE.Vector2(0, 0) },
  shallowColor: { value: new THREE.Color(0x2db5a0) },  // 近岸浅滩：明亮青绿
  deepColor: { value: new THREE.Color(0x0a3d5c) },     // 离岸深水：深海蓝
  horizonColor: { value: new THREE.Color(0x1a4a6e) },  // 远海：地平线蓝灰
  envMapIntensity: { value: 1.5 },
  roughness: { value: 0.12 },
  islandCenter: { value: new THREE.Vector2(0, 0) },
  fogColor: { value: new THREE.Color(0xc97e58) },
  fogNear: { value: 260.0 },
  fogFar: { value: 1600.0 }
};
const oceanMat = new THREE.ShaderMaterial({
  uniforms: oceanUniforms,
  vertexShader: `
    varying vec2 vUv;
    varying vec3 vWorldPos;
    void main() {
      vUv = uv;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: `
    uniform sampler2D normalMap;
    uniform float normalScale;
    uniform vec2 normalOffset;
    uniform vec3 shallowColor;
    uniform vec3 deepColor;
    uniform vec3 horizonColor;
    uniform float envMapIntensity;
    uniform float roughness;
    uniform vec2 islandCenter;
    uniform vec3 fogColor;
    uniform float fogNear;
    uniform float fogFar;
    varying vec2 vUv;
    varying vec3 vWorldPos;

    float smoothstep2(float edge0, float edge1, float x) {
      float t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
      return t * t * (3.0 - 2.0 * t);
    }

    void main() {
      float dist = length(vWorldPos.xz - islandCenter);

      // 三段式颜色混合
      float shallowFactor = 1.0 - smoothstep2(400.0, 750.0, dist);
      float horizonFactor = smoothstep2(1200.0, 2800.0, dist);
      vec3 waterColor = mix(deepColor, shallowColor, shallowFactor);
      waterColor = mix(waterColor, horizonColor, horizonFactor);

      // 法线扰动（模拟波纹）
      vec2 uv1 = vUv * 48.0 + normalOffset;
      vec2 uv2 = vUv * 48.0 - normalOffset * 0.7;
      vec3 n1 = texture2D(normalMap, uv1).rgb * 2.0 - 1.0;
      vec3 n2 = texture2D(normalMap, uv2).rgb * 2.0 - 1.0;
      vec3 waveNormal = normalize(vec3((n1.xy + n2.xy) * normalScale, 1.0));

      // 简单光照模拟：法线扰动影响亮度
      float waveLight = dot(waveNormal, normalize(vec3(0.3, 1.0, 0.5))) * 0.5 + 0.5;
      waterColor *= 0.85 + 0.3 * waveLight;

      // 高光（模拟太阳/月亮反射）
      vec3 viewDir = normalize(cameraPosition - vWorldPos);
      vec3 halfDir = normalize(normalize(vec3(0.5, 0.8, 0.3)) + viewDir);
      float spec = pow(max(dot(waveNormal, halfDir), 0.0), 64.0) * envMapIntensity * 0.4;
      waterColor += vec3(spec);

      // 雾效（远海渐隐入天空）
      float viewDist = length(cameraPosition - vWorldPos);
      float fogFactor = smoothstep2(fogNear, fogFar, viewDist);
      waterColor = mix(waterColor, fogColor, fogFactor * 0.7);

      gl_FragColor = vec4(waterColor, 1.0);
    }
  `,
  fog: false
});
const ocean = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), oceanMat);
ocean.rotation.x = -Math.PI / 2;
scene.add(ocean);
G.water = ocean;
G.waterOK = true;
const fallbackOcean = ocean; // 兼容旧引用（同一网格）
new THREE.TextureLoader().load(
  'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/textures/waternormals.jpg',
  (tex) => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(48, 48);
    oceanUniforms.normalMap.value = tex;
  }
);

// ---------- 公路 ----------
function buildRoad() {
  // 程序化沥青：噪点 + 车辙磨痕
  const asphaltTex = (() => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    const x = cv.getContext('2d');
    x.fillStyle = '#2c2c31';
    x.fillRect(0, 0, 256, 256);
    const img = x.getImageData(0, 0, 256, 256);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random()-0.5)*24 + (Math.random() < 0.012 ? 26 : 0);
      img.data[i] += n; img.data[i+1] += n; img.data[i+2] += n;
    }
    x.putImageData(img, 0, 0);
    for (const cx of [77, 179]) { // 两条车道的轮迹磨光带
      const gr = x.createLinearGradient(cx-22, 0, cx+22, 0);
      gr.addColorStop(0, 'rgba(210,210,220,0)');
      gr.addColorStop(0.5, 'rgba(210,210,220,0.09)');
      gr.addColorStop(1, 'rgba(210,210,220,0)');
      x.fillStyle = gr;
      x.fillRect(cx-22, 0, 44, 256);
    }
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  // 路面：Road009B 真实沥青 PBR（含居中黄线）。横向不平铺(ClampToEdge → 黄线居中) + 沿长度平铺
  const _rl2 = new THREE.TextureLoader();
  const rd2D = _rl2.load('assets/terrain/road2_diff.jpg'); rd2D.colorSpace = THREE.SRGBColorSpace; rd2D.wrapS = THREE.ClampToEdgeWrapping; rd2D.wrapT = THREE.RepeatWrapping; rd2D.repeat.set(1, 0.55); rd2D.anisotropy = 8;
  const rd2N = _rl2.load('assets/terrain/road2_nrm.webp'); rd2N.wrapS = THREE.ClampToEdgeWrapping; rd2N.wrapT = THREE.RepeatWrapping; rd2N.repeat.set(1, 0.55); rd2N.anisotropy = 8;
  const rd2R = _rl2.load('assets/terrain/road2_rough.webp'); rd2R.wrapS = THREE.ClampToEdgeWrapping; rd2R.wrapT = THREE.RepeatWrapping; rd2R.repeat.set(1, 0.55); rd2R.anisotropy = 8;
  const roadMat = new THREE.MeshStandardMaterial({ map: rd2D, normalMap: rd2N, roughnessMap: rd2R, roughness:1.0, metalness:0, envMapIntensity:0.4 });
  roadMat.normalScale.set(0.5, 0.5);
  // 湿路面系统：wetness 0=干燥 1=全湿，降低 roughness + 增加 envMapIntensity → 路面出现环境反射
  roadMat.userData.wetness = 0;
  roadMat.onBeforeCompile = (shader) => {
    shader.uniforms.wetness = { value: 0 };
    roadMat.userData.shader = shader;
    // 注入 wetness 控制：湿路面降低 roughness、提高 envMapIntensity、轻微加深颜色
    shader.fragmentShader = shader.fragmentShader.replace(
      'void main() {',
      `uniform float wetness;
       void main() {`
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>
       roughnessFactor = mix(roughnessFactor, 0.18, wetness);`
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
       diffuseColor.rgb *= mix(1.0, 0.72, wetness);
       // 路肩磨损暗化：UV.x 靠近 0/1 边缘处变暗
       float edgeWear = smoothstep(0.0, 0.12, vMapUv.x) * smoothstep(1.0, 0.88, vMapUv.x);
       diffuseColor.rgb *= mix(0.65, 1.0, edgeWear);
       // 随机脏化斑块：程序化噪声打破均匀感
       float dirt1 = sin(vMapUv.y * 47.0 + 1.3) * sin(vMapUv.x * 23.0 + 0.7) * 0.5 + 0.5;
       float dirt2 = sin(vMapUv.y * 89.0 + 3.1) * cos(vMapUv.x * 51.0 + 2.4) * 0.5 + 0.5;
       float dirtPattern = dirt1 * 0.6 + dirt2 * 0.4;
       diffuseColor.rgb *= mix(0.82, 1.0, dirtPattern);`
    );
  };
  const shoulderMat = new THREE.MeshStandardMaterial({color:0x615a50, roughness:1});
  const lineMat = new THREE.MeshStandardMaterial({color:0xdadada, roughness:0.85, emissive:0x0a0a0a});
  const dashMat = new THREE.MeshStandardMaterial({color:0xe8c44a, roughness:0.85, emissive:0x141000});
  // GAP（采样点数）：主路在每个 Y 路口前后各退 GAP 点，留出缝合面广场空间（可调）。
  const GAP = 6;
  // 主路是闭环（NS=800），被两个路口 BRANCH_A=120 / BRANCH_B=480 切成 2 段弧：
  //   弧1：[BRANCH_A+GAP, BRANCH_B-GAP]
  //   弧2：[BRANCH_B+GAP, BRANCH_A-GAP]（沿环绕过 index 0 回到起点）
  // ribbon(start,end) 沿环从 start 走到 end（含端点），自动处理 wrap。
  // 不传 start/end 时保持原全环行为（向后兼容）。
  function ribbon(off1, off2, yLift, mat, startIdx, endIdx) {
    const pts = [], uvs = [], idx = [];
    let count;            // 区间内段数
    let getK;             // i → samples 索引
    if (startIdx === undefined || endIdx === undefined) {
      count = NS;
      getK = (i) => i % NS;          // 全环：0..NS（首尾相接）
    } else {
      // 沿环从 startIdx 行进到 endIdx（含两端）。span = 段数。
      count = (endIdx - startIdx + NS) % NS;
      getK = (i) => (startIdx + i) % NS;
    }
    for (let i = 0; i <= count; i++) {
      const k = getK(i), p = samples[k], n = normals[k];
      pts.push(p.x + n.x*off1, p.y + yLift, p.z + n.z*off1,
               p.x + n.x*off2, p.y + yLift, p.z + n.z*off2);
      uvs.push(0, i*0.5, 1, i*0.5);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    for (let i = 0; i < count; i++) { const a = i*2; idx.push(a, a+1, a+2, a+1, a+3, a+2); }
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    return m;
  }
  // [task-20260620-001 回滚] 主路 5 条带恢复全环生成（不传起止索引），
  // 不再按 ARC1/ARC2 两段弧切断 —— 道路不再在路口断开。
  for (const [o1, o2, yl, mt] of [
    [-HALF_W, HALF_W, 0.05, roadMat],
    [-HALF_W-1.1, -HALF_W, 0.03, shoulderMat],
    [HALF_W, HALF_W+1.1, 0.03, shoulderMat],
    [-HALF_W+0.45, -HALF_W+0.62, 0.07, lineMat],
    [HALF_W-0.62, HALF_W-0.45, 0.07, lineMat],
  ]) {
    scene.add(ribbon(o1, o2, yl, mt));
  }
  // 路口缺口判定：i 是否落在某个 Y 路口的 ±GAP 范围内（用于虚线跳过）
  const inJunctionGap = (i) => {
    const da = Math.min((i - BRANCH_A + NS) % NS, (BRANCH_A - i + NS) % NS);
    const db = Math.min((i - BRANCH_B + NS) % NS, (BRANCH_B - i + NS) % NS);
    return da <= GAP || db <= GAP;
  };
  const dashPts = [], dashIdx = [];
  let vi = 0;
  for (let i = 0; i < NS; i++) {
    if (i % 10 >= 5) continue;
    if (inJunctionGap(i)) continue; // 路口区不画中线虚线
    const p = samples[i], n = normals[i], p2 = samples[(i+1)%NS], n2 = normals[(i+1)%NS];
    dashPts.push(p.x-n.x*0.12, p.y+0.07, p.z-n.z*0.12,  p.x+n.x*0.12, p.y+0.07, p.z+n.z*0.12,
                 p2.x-n2.x*0.12, p2.y+0.07, p2.z-n2.z*0.12,  p2.x+n2.x*0.12, p2.y+0.07, p2.z+n2.z*0.12);
    dashIdx.push(vi, vi+1, vi+2, vi+1, vi+3, vi+2); vi += 4;
  }
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(dashPts), 3));
  dg.setIndex(dashIdx); dg.computeVertexNormals();
  scene.add(new THREE.Mesh(dg, dashMat));

  // —— 支线公路 + 跨谷桥（桥墩 / 桥护栏 / 桥面侧裙）
  // GAP_B：支线在两端接主路处各退 GAP_B 点截断，留出干净断头给缝合面（可调）。
  const GAP_B = 6;
  const NBL = bSamples.length;            // 支线采样点数
  // —— 任务1：支路断头改为「动态求 index」（不再固定退 GAP_B）——
  // 根因：支路在接路口前曲线先过冲甩出再勾回（hairpin）。固定退 6 点（B_E=254）断头
  // 停在 hairpin 弧外、距 patch 中心 16.9m > hubR(14.8) → hairpin 段露在 patch 外 = 舌头。
  // 修复：从支路一端沿采样点走向路口，找到「该点到本路口 patch 中心距离 ≤ hubR」的
  // 第一个点作为断头。这样断头正好停在 hub 边缘、被 patch 接住，hairpin 过冲段不再绘制。
  // hub 中心/半径仅由两条「主路臂」决定（与支路断头无关，避免鸡生蛋），半径用 main-only
  // hubR（min 两主臂到中心距离 - HUB_INSET），与 buildJunctionPatch 内 hubRmain 同源。
  const _HUB_INSET = 2.5;     // 与下方 patch HUB_INSET 保持一致
  const _PATCH_OVERLAP = 0.4; // 与下方 patch PATCH_OVERLAP 一致（断头沿切线伸入路里）
  // 给定路口两个主路断头 index，算 hub 中心(cx,cz) 与 main-only hubR。
  function junctionHubMainOnly(mainEnd1Idx, mainEnd2Idx) {
    const jcx = (samples[mainEnd1Idx].x + samples[mainEnd2Idx].x) / 2;
    const jcz = (samples[mainEnd1Idx].z + samples[mainEnd2Idx].z) / 2;
    const inner = (endIdx) => {
      const p0 = samples[endIdx], t0 = tangents[endIdx], n = normals[endIdx];
      const dirSign = (Math.sign((p0.x - jcx) * t0.x + (p0.z - jcz) * t0.z) || 1);
      const ox = p0.x + t0.x * dirSign * _PATCH_OVERLAP;
      const oz = p0.z + t0.z * dirSign * _PATCH_OVERLAP;
      // 内排中点 = 中心线点（L/R 关于中心线对称，中点即 ox,oz）
      return { x: ox, z: oz };
    };
    const m0 = inner(mainEnd1Idx), m1 = inner(mainEnd2Idx);
    const cx = (m0.x + m1.x) / 2, cz = (m0.z + m1.z) / 2;
    const d0 = Math.hypot(m0.x - cx, m0.z - cz), d1 = Math.hypot(m1.x - cx, m1.z - cz);
    const hubR = Math.max(2.0, Math.min(d0, d1) - _HUB_INSET);
    return { cx, cz, hubR };
  }
  // 沿支路从一端走向路口，返回第一个「到 hub 中心 ≤ hubR」的 bSamples index。
  // fromEnd='start' 从 i=0 递增；fromEnd='end' 从 i=NBL-1 递减。
  function dynBranchCut(mainEnd1Idx, mainEnd2Idx, fromEnd) {
    const { cx, cz, hubR } = junctionHubMainOnly(mainEnd1Idx, mainEnd2Idx);
    if (fromEnd === 'end') {
      for (let i = 0; i < NBL; i++) {
        if (Math.hypot(bSamples[i].x - cx, bSamples[i].z - cz) <= hubR) return i;
      }
      return NBL - 1 - GAP_B;
    } else {
      for (let i = NBL - 1; i >= 0; i--) {
        if (Math.hypot(bSamples[i].x - cx, bSamples[i].z - cz) <= hubR) return i;
      }
      return GAP_B;
    }
  }
  // [task-20260620-001 回滚] 取消支路端头动态截断：B_S/B_E 及主路断头辅助索引
  // (_mAe1/_mAe2/_mBe1/_mBe2) 仅服务于截断/patch，回滚后变为未使用，故一并删除。
  // junctionHubMainOnly / dynBranchCut 为 function declaration（不算 unused），保留定义。
  function branchRibbon(off1, off2, yLift, mat, sIdx, eIdx) {
    const s = (sIdx === undefined) ? 0 : sIdx;
    const e = (eIdx === undefined) ? NBL - 1 : eIdx;
    const pts = [], uvs = [], idx = [];
    let row = 0;
    for (let i = s; i <= e; i++, row++) {
      const p = bSamples[i], n = bNormals[i];
      pts.push(p.x + n.x*off1, p.y + yLift, p.z + n.z*off1,
               p.x + n.x*off2, p.y + yLift, p.z + n.z*off2);
      uvs.push(0, i*0.5, 1, i*0.5);
      if (i < e) { const a = row*2; idx.push(a, a+1, a+2, a+1, a+3, a+2); }
    }
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
    g2.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    g2.setIndex(idx);
    g2.computeVertexNormals();
    const m2 = new THREE.Mesh(g2, mat);
    m2.receiveShadow = true;
    return m2;
  }
  // 支线路面铺在主路面之下（0.045 < 主路 0.05）：汇入口重叠处由更宽的主路覆盖，
  // 消除"窄支线贴片盖在主路上"造成的衔接错位/闪烁；车道线仍高于两条路面以保持可见。
  // 两端各退 GAP_B 截断，断头由程序化缝合面接住。
  // [task-20260620-001 回滚] 3 条 branchRibbon 恢复全程生成（不传 B_S/B_E，默认 0..NBL-1）：
  scene.add(branchRibbon(-B_HALF, B_HALF, 0.045, roadMat));
  scene.add(branchRibbon(-B_HALF + 0.4, -B_HALF + 0.55, 0.065, lineMat));
  scene.add(branchRibbon(B_HALF - 0.55, B_HALF - 0.4, 0.065, lineMat));

  // —— 路口铺面（junction apron）：支线汇入主路处，两条直纹路面以夹角相交会留下
  // 一块没有沥青覆盖的楔形缺口（露出地形 + 边线交叉穿模）。这里用"主路边沿 + 支线边沿"
  // 采样点的凸包生成一块贴合路面高度的沥青补片，盖住缺口并覆盖杂乱的交叉车道线。
  // —— 程序化路口缝合面（每个 Y 路口一块）：三条臂（主路A/主路B/支路）各取 3 排
  // 横截面形成有纵深的「臂带」，中心生成 8~12 点 hub 环；先 hub fan 三角化，再每条臂
  // 独立缝到 hub（分臂 strip 防自交蝴蝶结）。最内排沿切线 overlap 进原路消浮点缝。
  // 材质 = 独立沥青 PBR（asphalt026c）：深黑沥青带细裂纹。这是 patch 独立 mesh 的独立
  // 材质（自己的 shader 程序、自己的采样器预算），绝不碰 terrain material、绝不给 terrain
  // 加采样器 → 不会触发 terrain 变蓝。贴图 wrap=Repeat，配合下方按世界 xz 生成的 UV 正常平铺。
  const _rkP = 'assets/terrain/roadkit/asphalt026c/';
  const _rkL = new THREE.TextureLoader();
  const _rkColor = (u) => { const t = _rkL.load(u); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  const _rkData  = (u) => { const t = _rkL.load(u); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; };
  const patchMat = new THREE.MeshStandardMaterial({
    map: _rkColor(_rkP + 'diff.jpg'),
    normalMap: _rkData(_rkP + 'nrm.jpg'),
    roughnessMap: _rkData(_rkP + 'rough.jpg'),
    roughness: 1.0,
    metalness: 0.0,
    envMapIntensity: 0.4, // 与主路 ribbon(0.4) 一致，避免一块反光一块不反光
  });
  patchMat.normalScale.set(0.6, 0.6);
  // mainEnd1Idx/mainEnd2Idx：该路口主路两个断头的 samples 索引（已退 GAP）
  // branchEndIdx：该路口支线断头的 bSamples 索引（已退 GAP_B）
  // OVERLAP：缝合面顶点沿各断头的路方向往路里多伸 PATCH_OVERLAP m，
  // 与 ribbon 最后一行重叠一点点，消除亚像素黑缝（比追求绝对精确更稳）。
  const PATCH_OVERLAP = 0.4;
  // 横截面排距（采样点步长）与中心 hub 点数、覆盖量（可调）：
  const SEC_STEP = 2;        // 每排相隔 SEC_STEP 个采样点（规格1，约 2~3）
  const SEC_ROWS = 3;        // 每条臂取 3 排横截面（规格1/2）
  const HUB_PTS = 10;        // 中心 hub 环点数 8~12（规格4）
  const HUB_INSET = 2.5;     // 修复C：hubR 从最近臂距离往内缩 HUB_INSET（m），让圆盘不捣出路外形成舌头
  const PATCH_TILE = 7.0;    // 修复B(UV)：沥青贴图世界平铺周期（m/一遍，~6~8m），UV = worldXZ / PATCH_TILE
  function buildJunctionPatch(mainEnd1Idx, mainEnd2Idx, branchEndIdx) {
    // ---- 规格1+2：每路口三条臂，每臂取 SEC_ROWS 排横截面（断头 + 往路里退）----
    // 路口中心 = 三断头中心线点均值（先算，供 overlap 朝向用）
    const jcx = (samples[mainEnd1Idx].x + samples[mainEnd2Idx].x + bSamples[branchEndIdx].x) / 3;
    const jcz = (samples[mainEnd1Idx].z + samples[mainEnd2Idx].z + bSamples[branchEndIdx].z) / 3;
    // 一条臂 = 由内到外的 SEC_ROWS 排，每排 {L,R}（左右边缘点，含高度）。
    // rows[0] = 最靠路口（断头排，做 overlap）；rows[last] = 最往路里那排。
    // src=主路 samples / 支路 bSamples；getIdx(r) 给出第 r 排的索引（朝路里方向递增）。
    const buildArm = (isMain, endIdx) => {
      const S = isMain ? samples : bSamples;
      const Nn = isMain ? normals : bNormals;
      const Tn = isMain ? tangents : bTangents;
      const half = isMain ? HALF_W : B_HALF;
      const Len = S.length;
      // 朝路里方向：从断头沿“远离路口中心”的相邻采样点判定符号
      const p0 = S[endIdx], t0 = Tn[endIdx];
      // dirSign：沿 tangent 哪个方向是“离开路口、进入既有 ribbon”
      const dirSign = (Math.sign((p0.x - jcx) * t0.x + (p0.z - jcz) * t0.z) || 1);
      const rows = [];
      for (let r = 0; r < SEC_ROWS; r++) {
        // r=0 断头排；r 增大 = 往路里退（沿 dirSign 方向移动索引）
        let k = endIdx + (isMain ? dirSign : -dirSign) * r * SEC_STEP;
        if (isMain) k = ((k % NS) + NS) % NS; else k = Math.max(0, Math.min(Len - 1, k));
        const p = S[k], n = Nn[k], t = Tn[k];
        const y = p.y + 0.05; // 与 ribbon yLift=0.05 同高（统一高度来源，消 z-fight）
        let ox = p.x, oz = p.z;
        if (r === 0) {
          // 规格3：最内排沿切线往路里伸 overlap，与 ribbon 最后一行重叠杜绝浮点缝
          ox += t.x * dirSign * PATCH_OVERLAP;
          oz += t.z * dirSign * PATCH_OVERLAP;
        }
        rows.push({
          L: { x: ox + n.x * half, y, z: oz + n.z * half },
          R: { x: ox - n.x * half, y, z: oz - n.z * half },
          cx: ox, cz: oz, y,
        });
      }
      return rows;
    };
    const arms = [
      buildArm(true, mainEnd1Idx),
      buildArm(true, mainEnd2Idx),
      buildArm(false, branchEndIdx),
    ];
    // 每条臂内排中点（rows[0] 的 L/R 中点）——对接锚点（arms[0]=main1, arms[1]=main2, arms[2]=branch）
    const innerMid = arms.map(a => ({
      x: (a[0].L.x + a[0].R.x) / 2,
      z: (a[0].L.z + a[0].R.z) / 2,
      y: a[0].y,
    }));
    // 修复1：hub 中心 = 两个 main 断头内排中点的中点（不再被支路+近邻 main 拽偏）。
    //   这样两条 main 臂对 hub 对称，远侧 main 臂不再落在环外悬空。
    const cx = (innerMid[0].x + innerMid[1].x) / 2;
    const cz = (innerMid[0].z + innerMid[1].z) / 2;
    // 修复C（舌头）：hubR 不再 = mainGapHalf + 余量（会让圆盘往路外捣出舌头），
    //   改为 hubR = min(三臂到中心距离) - HUB_INSET。这样三臂内排都落在圈外，
    //   每臂 strip 向内桥接到 hub（向内 overlap，无洞），hub 圆盘完全落在三路路面内，
    //   不再往路外（主路截断点外侧 / 背离支路一侧）捣出尖角。
    const armDist = innerMid.map(m => Math.hypot(m.x - cx, m.z - cz));
    const hubR = Math.max(2.0, Math.min(...armDist) - HUB_INSET);
    // 修复3：hub 各环点 y 不用单一平均，按角度在三断头 y 之间做角度加权（反距离）插值。
    //   每个环点用最接近的断头（main1/main2/branch）y 加权，消除高度落差架空。
    const endAng = innerMid.map(m => Math.atan2(m.z - cz, m.x - cx));
    const endY = [innerMid[0].y, innerMid[1].y, innerMid[2].y];
    const angDiff = (a, b) => Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    const yAtAng = (a) => {
      let wsum = 0, ysum = 0, exact = null;
      for (let j = 0; j < 3; j++) {
        const d = angDiff(a, endAng[j]);
        if (d < 1e-4) { exact = endY[j]; break; }
        const w = 1 / (d * d);
        wsum += w; ysum += w * endY[j];
      }
      return exact !== null ? exact : ysum / wsum;
    };
    // hub 中心顶点 y：三断头均权
    const cy = (endY[0] + endY[1] + endY[2]) / 3;
    // 8~12 点 hub 环（按角度均匀分布，y 按角度插值消架空）
    const hub = [];
    for (let i = 0; i < HUB_PTS; i++) {
      const a = (i / HUB_PTS) * Math.PI * 2;
      hub.push({ x: cx + Math.cos(a) * hubR, z: cz + Math.sin(a) * hubR, y: yAtAng(a), ang: a });
    }
    const verts = [], uvs = [], idx = [];
    // 修复B(UV)：按世界 xz 生成 UV（uv = worldXZ / PATCH_TILE），让沥青纹理正常平铺、有真实细节，
    // 不再是单色糊面/马赛克（原来 (x-cx)*0.04 缩放 + roadMat 的 ClampToEdge 贴图是马赛克根因）。
    const push = (x, y, z) => { const i = verts.length / 3; verts.push(x, y, z); uvs.push(x / PATCH_TILE, z / PATCH_TILE); return i; };
    // ---- 三角化① 中心 hub fan（中心点 → hub 环，稳定凸多边形不自交，规格4）----
    const cIdx = push(cx, cy, cz);
    const hubIdx = hub.map(h => push(h.x, h.y, h.z));
    for (let i = 0; i < HUB_PTS; i++) {
      idx.push(cIdx, hubIdx[i], hubIdx[(i + 1) % HUB_PTS]);
    }
    // ---- 三角化② 每条臂带 (SEC_ROWS×2 点) 独立缝到 hub 环对应弧段 ----
    // 每条臂在 hub 上取“离该臂左右边缘点角度最近”的两个环点，与臂带最内排 L/R 缝合，
    // 再把臂带各排之间连成 triangle strip 一路盖到断头排。分臂独立 → 互不串扰、不自交。
    const angOf = (x, z) => Math.atan2(z - cz, x - cx);
    const nearestHub = (x, z) => {
      let best = 0, bestD = Infinity;
      const a = angOf(x, z);
      for (let i = 0; i < HUB_PTS; i++) {
        let d = Math.abs(((hub[i].ang - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (d < bestD) { bestD = d; best = i; }
      }
      return best;
    };
    for (let ai = 0; ai < arms.length; ai++) {
      const rows = arms[ai];
      // 臂带顶点：先 push 所有排的 L/R，记录索引（[r].L,[r].R）
      const vL = [], vR = [];
      for (let r = 0; r < SEC_ROWS; r++) {
        vL.push(push(rows[r].L.x, rows[r].L.y, rows[r].L.z));
        vR.push(push(rows[r].R.x, rows[r].R.y, rows[r].R.z));
      }
      // 臂带内部 strip：相邻两排 L/R 连成四边形（盖住臂带纵深，r:0..SEC_ROWS-1）
      for (let r = 0; r < SEC_ROWS - 1; r++) {
        idx.push(vL[r], vR[r], vL[r + 1]);
        idx.push(vR[r], vR[r + 1], vL[r + 1]);
      }
      // 内排 L/R 缝到 hub：取最近的两个环点，三角化成两片把臂口接到 hub 边
      const hL = nearestHub(rows[0].L.x, rows[0].L.z);
      const hR = nearestHub(rows[0].R.x, rows[0].R.z);
      idx.push(vL[0], hubIdx[hL], vR[0]);
      idx.push(hubIdx[hL], hubIdx[hR], vR[0]);
    }
    // ---- 任务2：路口曲线过渡（硬切 → 弧形）----
    // 相邻两臂的断头之间原本是 hub 多边形直边角；这里在两臂「面向缺口」的断头外角点
    // 之间用 Catmull-Rom 生成一段平滑外弧（切线沿各臂边缘方向），再每段独立 fan 三角化
    // 到 hub 中心，把硬切角填成弧形过渡。三臂 → 3 段过渡弧；每段独立 strip 防自交。
    // 高度沿 yAtAng（与三断头连续）；UV 仍按世界 xz 平铺（push 内统一处理），不动 terrain。
    {
      const TWO_PI = Math.PI * 2;
      const wrap = (a) => ((a % TWO_PI) + TWO_PI) % TWO_PI;
      const angDist = (a, b) => Math.abs(((a - b + Math.PI * 3) % TWO_PI) - Math.PI);
      // 每臂两个断头外角点 {L,R}（rows[0]，含 overlap）+ 中点角度，按中点角度排臂序
      const armCorners = arms.map((rows) => {
        const Lc = rows[0].L, Rc = rows[0].R;
        return {
          L: { x: Lc.x, z: Lc.z, ang: angOf(Lc.x, Lc.z) },
          R: { x: Rc.x, z: Rc.z, ang: angOf(Rc.x, Rc.z) },
          mid: angOf((Lc.x + Rc.x) / 2, (Lc.z + Rc.z) / 2),
        };
      });
      const order = armCorners.map((_, i) => i).sort((a, b) => wrap(armCorners[a].mid) - wrap(armCorners[b].mid));
      const ARC_SEG = 6; // 每段过渡弧细分段数（独立 strip）
      for (let oi = 0; oi < order.length; oi++) {
        const ca = armCorners[order[oi]];
        const cb = armCorners[order[(oi + 1) % order.length]];
        // ca 朝向 cb 的角点 = ca 两角点中距 cb.mid 角距最小者；反之为远端。
        const caNear = angDist(ca.L.ang, cb.mid) < angDist(ca.R.ang, cb.mid) ? ca.L : ca.R;
        const caFar  = caNear === ca.L ? ca.R : ca.L;
        const cbNear = angDist(cb.L.ang, ca.mid) < angDist(cb.R.ang, ca.mid) ? cb.L : cb.R;
        const cbFar  = cbNear === cb.L ? cb.R : cb.L;
        // Catmull-Rom：[caFar, caNear, cbNear, cbFar]，端点切线由本臂另一角点给出（沿路边方向）
        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(caFar.x, 0, caFar.z),
          new THREE.Vector3(caNear.x, 0, caNear.z),
          new THREE.Vector3(cbNear.x, 0, cbNear.z),
          new THREE.Vector3(cbFar.x, 0, cbFar.z),
        ], false, 'catmullrom', 0.5);
        // 仅取 caNear→cbNear 中间段（t:1/3..2/3）生成外弧，y 沿 yAtAng 连续
        const arcPts = [];
        for (let s = 0; s <= ARC_SEG; s++) {
          const t = 1 / 3 + (s / ARC_SEG) * (1 / 3);
          const p = curve.getPoint(t);
          const a = angOf(p.x, p.z);
          arcPts.push(push(p.x, yAtAng(a), p.z));
        }
        // 每段弧点与 hub 中心 fan 三角化（独立 strip，不自交）
        for (let s = 0; s < ARC_SEG; s++) {
          idx.push(cIdx, arcPts[s], arcPts[s + 1]);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, patchMat); m.receiveShadow = true;
    scene.add(m);
    // 返回 hub 中心与几何统计供 handoff 验证
    return { cx, cy, cz, hubR, hubPts: HUB_PTS, armSectionPts: arms.length * SEC_ROWS * 2, verts: verts.length / 3, tris: idx.length / 3 };
  }
  // [task-20260620-001 回滚] 禁用 buildJunctionPatch（函数定义保留，仅不调用）：
  // 路口 A：主路断头 = BRANCH_A±GAP；支线断头 = bSamples[B_S]（起点端）
  // buildJunctionPatch((BRANCH_A - GAP + NS) % NS, (BRANCH_A + GAP) % NS, B_S);
  // 路口 B：主路断头 = BRANCH_B±GAP；支线断头 = bSamples[B_E]（末端）
  // buildJunctionPatch((BRANCH_B - GAP + NS) % NS, (BRANCH_B + GAP) % NS, B_E);

  const pylonM = new THREE.MeshStandardMaterial({color:0x8d8d94, roughness:0.8});
  const bRailM = new THREE.MeshStandardMaterial({color:0xd8d8de, roughness:0.5, metalness:0.5});
  const skirtM = new THREE.MeshStandardMaterial({color:0x55565e, roughness:0.85});
  const pylGeos = [], bRailGeos = [];
  const tmpB = new THREE.Object3D();
  for (let i = 0; i < bSamples.length - 1; i++) {
    if (!bBridge[i]) continue;
    const p = bSamples[i], n = bNormals[i];
    if (i % 6 === 0) { // 桥墩
      const hb = Math.max(islandBase(p.x, p.z), -2);
      const hgt = Math.max(p.y - hb, 1);
      const py = new THREE.BoxGeometry(1.3, hgt, 1.3);
      py.translate(p.x, hb + hgt/2, p.z);
      pylGeos.push(py);
    }
    const p2 = bSamples[i+1], n2 = bNormals[i+1];
    for (const s of [-1, 1]) { // 护栏矮墙
      const a = new THREE.Vector3(p.x + n.x*s*(B_HALF + 0.12), p.y + 0.5, p.z + n.z*s*(B_HALF + 0.12));
      const b2 = new THREE.Vector3(p2.x + n2.x*s*(B_HALF + 0.12), p2.y + 0.5, p2.z + n2.z*s*(B_HALF + 0.12));
      tmpB.position.copy(a).lerp(b2, 0.5);
      tmpB.lookAt(b2);
      tmpB.updateMatrix();
      bRailGeos.push(new THREE.BoxGeometry(0.2, 1.0, a.distanceTo(b2) + 0.06).applyMatrix4(tmpB.matrix));
    }
  }
  if (pylGeos.length) {
    const pm = new THREE.Mesh(mergeGeometries(pylGeos), pylonM);
    pm.castShadow = true;
    scene.add(pm);
    scene.add(branchRibbon(-B_HALF - 0.15, B_HALF + 0.15, -0.45, skirtM)); // 桥面底裙
  }
  if (bRailGeos.length) {
    const rm = new THREE.Mesh(mergeGeometries(bRailGeos), bRailM);
    rm.castShadow = true;
    scene.add(rm);
  }
  // （悬崖护栏已改为可破坏道具，见 gameplay.buildProps）

  // 绑定路面材质供 setRoadWetness 使用
  _bindRoadMat(roadMat);
}

// ---------- 植被 / 岩石（EZ-Tree 程序化森林，实例化渲染） ----------
async function buildScenery() {
  const palmTrunkG = new THREE.CylinderGeometry(0.14, 0.24, 5, 6);
  palmTrunkG.translate(0, 2.5, 0);
  const trunkM = new THREE.MeshStandardMaterial({color:0x8a6a4a, roughness:1});
  const leafG = new THREE.ConeGeometry(0.5, 3.2, 4);
  leafG.translate(0, 1.4, 0); leafG.rotateX(Math.PI/2.4);
  const leafM = new THREE.MeshStandardMaterial({color:0x3f7a3a, roughness:0.9});
  const rockG = new THREE.DodecahedronGeometry(1.6, 0);
  const rockM = new THREE.MeshStandardMaterial({color:0x7d7468, flatShading:true, roughness:0.9});
  // ---------- 森林斑块系统：替代旧的随机撒树 ----------
  // FASTDEBUG：树/灌木数量降到极小（generateForestSpots 是本函最耗时的生成步骤）
  const treeSpots = generateForestSpots({
    meshGroundHeight, groundHeight, nearestRoad, branchInfo, islandBase,
    targetTrees: FASTDEBUG ? 40 : 3500, targetBushes: FASTDEBUG ? 20 : 2400
  });

  // ---------- 棕榈（低地 < 3.5m）+ 散岩 ----------
  const trunkGeos = [], palmLeafGeos = [], rockGeos = [];
  const tmpO = new THREE.Object3D();
  let palmRockPlaced = 0, guard2 = 0;
  const palmRockTarget = FASTDEBUG ? 0 : 400; // FASTDEBUG：跳过棕榈/散岩撒点
  while (palmRockPlaced < palmRockTarget && guard2++ < 5000) {
    const a = Math.random()*Math.PI*2, r = 60 + Math.random()*520;
    const x = Math.cos(a)*r, z = Math.sin(a)*r;
    if (nearestRoad(x, z).dist < 16 || branchInfo(x, z).dist < 14) continue;
    const h = meshGroundHeight(x, z);
    if (h < 0.6 || h > 20) continue;
    const slope = Math.abs(groundHeight(x+5, z) - groundHeight(x-5, z))
                + Math.abs(groundHeight(x, z+5) - groundHeight(x, z-5));
    if (slope > 4) continue;
    if (h < 3.5) {
      tmpO.position.set(x, h, z);
      tmpO.rotation.set(0, Math.random()*Math.PI*2, (Math.random()-0.5)*0.22);
      tmpO.scale.setScalar(1);
      tmpO.updateMatrix();
      trunkGeos.push(palmTrunkG.clone().applyMatrix4(tmpO.matrix));
      for (let l = 0; l < 6; l++) {
        const lg2 = leafG.clone();
        lg2.rotateY(l/6*Math.PI*2);
        lg2.translate(0, 5, 0);
        lg2.applyMatrix4(tmpO.matrix);
        palmLeafGeos.push(lg2);
      }
    } else if (Math.random() < 0.18) {
      tmpO.position.set(x, h, z);
      tmpO.rotation.set(Math.random(), Math.random()*3, Math.random());
      tmpO.scale.setScalar(0.6 + Math.random()*1.6);
      tmpO.updateMatrix();
      rockGeos.push(rockG.clone().applyMatrix4(tmpO.matrix));
      tmpO.scale.setScalar(1);
    }
    palmRockPlaced++;
  }
  if (trunkGeos.length) {
    scene.add(new THREE.Mesh(mergeGeometries(trunkGeos), trunkM));
    scene.add(new THREE.Mesh(mergeGeometries(palmLeafGeos), leafM));
  }
  if (rockGeos.length) scene.add(new THREE.Mesh(mergeGeometries(rockGeos), rockM));
  // —— 实例化地被：花簇 / 芦苇 / 海岸礁石（每类仅 1 个 draw call）
  function scatter(geo, mat2, count, opt) {
    const inst = new THREE.InstancedMesh(geo, mat2, count);
    const dum = new THREE.Object3D();
    const col = new THREE.Color();
    let n2 = 0, gd = 0;
    while (n2 < count && gd++ < count*8) {
      const a = Math.random()*Math.PI*2, r = 40 + Math.random()*600;
      const x = Math.cos(a)*r, z = Math.sin(a)*r;
      if (nearestRoad(x, z).dist < opt.minRoad || branchInfo(x, z).dist < opt.minRoad) continue;
      const h = meshGroundHeight(x, z); // 贴渲染网格，消除地被悬浮
      if (h < opt.hMin || h > opt.hMax) continue;
      const slope = Math.abs(groundHeight(x+4, z) - groundHeight(x-4, z))
                  + Math.abs(groundHeight(x, z+4) - groundHeight(x, z-4));
      if (slope > 3) continue;
      dum.position.set(x, h - (opt.sink || 0.05), z);
      dum.rotation.y = Math.random()*Math.PI;
      const sc = opt.s0 + Math.random()*opt.s1;
      dum.scale.set(sc, sc*(opt.ys || 1), sc);
      dum.updateMatrix();
      inst.setMatrixAt(n2, dum.matrix);
      inst.setColorAt(n2, opt.color(col));
      n2++;
    }
    inst.count = n2;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    scene.add(inst);
  }
  const crossG = (() => {
    const a = new THREE.PlaneGeometry(0.3, 0.3); a.translate(0, 0.15, 0);
    const b = a.clone(); b.rotateY(Math.PI/2);
    return mergeGeometries([a, b]);
  })();
  const reedG = (() => {
    const a = new THREE.PlaneGeometry(0.22, 1.5); a.translate(0, 0.7, 0);
    const b = a.clone(); b.rotateY(Math.PI/2);
    return mergeGeometries([a, b]);
  })();
  const flowerM = new THREE.MeshLambertMaterial({color:0xffffff, map: flowerTexture(), alphaTest: 0.45, side: THREE.DoubleSide});
  const reedM2 = new THREE.MeshLambertMaterial({color:0xffffff, map: reedTexture(), alphaTest: 0.45, side: THREE.DoubleSide});
  scatter(crossG, flowerM, FASTDEBUG ? 0 : 800, { minRoad: 8, hMin: 3, hMax: 14, s0: 1.0, s1: 1.0, sink: 0.04,
    color: (c) => c.setHSL([0.95, 0.13, 0.0, 0.78][Math.floor(Math.random()*4)], 0.7, 0.66) }); // 花簇
  scatter(reedG, reedM2, FASTDEBUG ? 0 : 500, { minRoad: 9, hMin: 0.8, hMax: 2.8, s0: 0.8, s1: 1.0, ys: 1.2, sink: 0.06,
    color: (c) => c.setHSL(0.13 + Math.random()*0.04, 0.42, 0.34 + Math.random()*0.12) }); // 芦苇/滨草
  const reefG = new THREE.DodecahedronGeometry(1, 0);
  const reefM = new THREE.MeshStandardMaterial({color:0xffffff, roughness:0.9, flatShading:true});
  scatter(reefG, reefM, FASTDEBUG ? 0 : 120, { minRoad: 12, hMin: -0.2, hMax: 1.0, s0: 0.5, s1: 1.1, ys: 0.6, sink: 0.3,
    color: (c) => c.setHSL(0.08, 0.08, 0.3 + Math.random()*0.12) }); // 水线礁石

  // —— EZ-Tree：生成 9 种树形 → 每种 2 个 InstancedMesh（枝干+树叶）
  try {
    // 预烘焙树木资产（node bake-trees.mjs 离线生成）：免去 4MB 运行时代码包与生成耗时
    const [meta, bin] = await Promise.all([
      fetch('assets/trees/trees.json').then(r => r.json()),
      fetch('assets/trees/trees.bin').then(r => r.arrayBuffer())
    ]);
    const TARGET_H = [9, 13, 8.5, 9.5, 5.5, 11.5, 16, 1.8, 2.3];
    const texLoader = new THREE.TextureLoader();
    const texCache = {};
    const getTex = (f, wrap) => {
      if (!texCache[f]) {
        const tx = texLoader.load('assets/trees/' + f);
        tx.colorSpace = THREE.SRGBColorSpace;
        if (wrap) tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
        texCache[f] = tx;
      }
      return texCache[f];
    };
    const leafFile = (ty) => ({oak:'oak_color.png', ash:'ash_color.png', aspen:'aspen_color.png', pine:'pine_color.png'}[ty] || 'oak_color.png');
    const barkFile = (ty) => (ty === 'pine' || ty === 'birch') ? 'pine_color_1k.jpg' : 'oak_color_1k.jpg';
    function partGeo(p) {
      const g2 = new THREE.BufferGeometry();
      const n = p.vcount;
      const qp = new Int16Array(bin, p.pos, n*3);
      const qn = new Int8Array(bin, p.nor, n*3);
      const qu = new Uint16Array(bin, p.uv, n*2);
      const pos = new Float32Array(n*3), nor = new Float32Array(n*3), uv = new Float32Array(n*2);
      for (let i = 0; i < n*3; i++) { pos[i] = qp[i]/32760*p.posScale; nor[i] = qn[i]/127; }
      for (let i = 0; i < n*2; i++) uv[i] = qu[i]/65535*p.uvScale;
      g2.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g2.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g2.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g2.setIndex(new THREE.BufferAttribute(p.idx32 ? new Uint32Array(bin, p.idx, p.icount) : new Uint16Array(bin, p.idx, p.icount), 1));
      return g2;
    }
    const dummy = new THREE.Object3D();
    meta.variants.forEach((v, vi) => {
      const spots = treeSpots.filter(s => s.vi === vi);
      if (!spots.length) return;
      const bm = new THREE.MeshStandardMaterial({map: getTex(barkFile(v.barkType), true), color: v.barkTint, roughness: 0.9});
      const lm = new THREE.MeshStandardMaterial({map: getTex(leafFile(v.leafType)), color: v.leafTint, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9, metalness: 0});
      // 叶片风摆：按实例位置取相位，实例化兼容
      lm.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = windU;
        sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace(
          '#include <begin_vertex>',
          ['#include <begin_vertex>',
           '#ifdef USE_INSTANCING',
           '  float ph = instanceMatrix[3].x + instanceMatrix[3].z;',
           '#else',
           '  float ph = 0.0;',
           '#endif',
           'float sway = sin(uTime*1.6 + ph*0.35 + position.y*0.6) * 0.05 * (0.3 + uv.y);',
           'transformed.x += sway;',
           'transformed.z += sway*0.6;'].join('\n')
        );
      };
      const bi = new THREE.InstancedMesh(partGeo(v.parts.branch), bm, spots.length);
      const li = new THREE.InstancedMesh(partGeo(v.parts.leaf), lm, spots.length);
      const srcH = Math.max(v.srcH, 1);
      spots.forEach((s, k) => {
        dummy.position.set(s.x, s.h - 0.15, s.z);
        dummy.rotation.set(0, s.rot, 0);
        dummy.scale.setScalar(TARGET_H[vi] / srcH * s.s);
        dummy.updateMatrix();
        bi.setMatrixAt(k, dummy.matrix);
        li.setMatrixAt(k, dummy.matrix);
      });
      bi.castShadow = true;
      // 树叶投影：自定义深度材质支持 alphaTest 镂空
      li.castShadow = true;
      li.customDepthMaterial = new THREE.MeshDepthMaterial({depthPacking: THREE.RGBADepthPacking, map: getTex(leafFile(v.leafType)), alphaTest: 0.5});
      bi.instanceMatrix.needsUpdate = true;
      li.instanceMatrix.needsUpdate = true;
      scene.add(bi);
      scene.add(li);
    });
  } catch (err) {
    // 兜底：EZ-Tree 加载失败时退回简单树
    console.warn('EZ-Tree 不可用，使用简化树木：', err);
    const topG = new THREE.IcosahedronGeometry(2.4, 0);
    const topM = new THREE.MeshStandardMaterial({color:0x44653c, flatShading:true, roughness:0.95});
    const trkG = new THREE.CylinderGeometry(0.25, 0.4, 3, 5);
    for (const s of treeSpots) {
      const g = new THREE.Group();
      const tr = new THREE.Mesh(trkG, trunkM); tr.position.y = 1.5; g.add(tr);
      const tp = new THREE.Mesh(topG, topM); tp.position.y = 4.2; tp.scale.setScalar(s.s + 0.3); tp.castShadow = true; g.add(tp);
      g.position.set(s.x, s.h, s.z);
      scene.add(g);
    }
  }

  // ---------- 草地层 + 道路生态带 ----------
  // FASTDEBUG：跳过草地层（28000 实例，本模块最耗算力）与道路生态带
  if (!FASTDEBUG) {
  try {
    buildGrassLayer({
      scene, meshGroundHeight, groundHeight, nearestRoad, branchInfo, islandBase, windU, samples, normals
    });
  } catch (e) { console.warn('[GRASS] 草地层生成失败：', e); }

  try {
    buildRoadsideEcology({
      scene, samples, normals, meshGroundHeight, groundHeight, nearestRoad, branchInfo, islandBase, HALF_W
    });
  } catch (e) { console.warn('[ROADSIDE] 道路生态带生成失败：', e); }
  } else {
    console.log('[FASTDEBUG] buildScenery: skipped grass+roadside, trees=40 bushes=20, palm/rock+scatter=0');
  }
}

// ---------- 湿路面控制 ----------
// 外部调用 setRoadWetness(0~1) 控制路面湿润程度。0=干燥，1=全湿（雨后积水反光）
let _roadMat = null;
export function setRoadWetness(wetness) {
  if (!_roadMat) return;
  _roadMat.userData.wetness = wetness;
  if (_roadMat.userData.shader) {
    _roadMat.userData.shader.uniforms.wetness.value = wetness;
  }
  // 同时调整 envMapIntensity：湿路面更强环境反射
  _roadMat.envMapIntensity = 0.4 + wetness * 0.8; // 0.4(干) → 1.2(湿)
  _roadMat.needsUpdate = true;
}
// 内部引用：buildRoad 完成后设置 _roadMat
function _bindRoadMat(mat) { _roadMat = mat; }

// ---------- 环境造景：路灯 / 云 / 月 / 灯塔 / 萤火虫 / 草丛 / 远岛 ----------
function makeGlowTex(stops, size) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size || 256;
  const x = cv.getContext('2d');
  const g = x.createRadialGradient(cv.width/2, cv.height/2, 0, cv.width/2, cv.height/2, cv.width/2);
  for (const [o, c] of stops) g.addColorStop(o, c);
  x.fillStyle = g;
  x.fillRect(0, 0, cv.width, cv.height);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const env = {};
function buildEnv() {
  // —— 海滨路灯（夜间点亮；柱/臂、灯头、光斑各烘焙成 1 个网格）
  const poleG = new THREE.CylinderGeometry(0.07, 0.10, 4.6, 6);
  const armG = new THREE.BoxGeometry(0.06, 0.06, 1.5);
  const headG = new THREE.BoxGeometry(0.42, 0.09, 0.2);
  const poleM = new THREE.MeshStandardMaterial({color:0x3a3f46, roughness:0.6, metalness:0.7});
  env.lampHeadM = new THREE.MeshStandardMaterial({color:0xfff2cf, emissive:0xffdf9e, emissiveIntensity:0.12});
  const poolTex = makeGlowTex([[0,'rgba(255,220,160,0.85)'],[0.5,'rgba(255,210,140,0.28)'],[1,'rgba(255,200,120,0)']]);
  const poolG = new THREE.PlaneGeometry(10, 10);
  const poolM = new THREE.MeshBasicMaterial({map:poolTex, transparent:true, opacity:0.4, blending:THREE.AdditiveBlending, depthWrite:false});
  const poleGeos = [], headGeos = [], poolGeos = [];
  const headPositions = []; // 记录灯头世界坐标，用于叠加面向相机的柔光晕 sprite
  const tmpL = new THREE.Object3D();
  for (let i = 0; i < NS; i += 16) {
    const p = samples[i], n = normals[i];
    const side = (i/16) % 2 === 0 ? 1 : -1;
    const bx = p.x + n.x*side*(HALF_W+1.0), bz = p.z + n.z*side*(HALF_W+1.0);
    tmpL.position.set(bx, p.y+2.3, bz);
    tmpL.rotation.set(0, 0, 0);
    tmpL.updateMatrix();
    poleGeos.push(poleG.clone().applyMatrix4(tmpL.matrix));
    tmpL.position.set(bx - n.x*side*0.72, p.y+4.55, bz - n.z*side*0.72);
    tmpL.lookAt(p.x, p.y+4.55, p.z);
    tmpL.updateMatrix();
    poleGeos.push(armG.clone().applyMatrix4(tmpL.matrix));
    tmpL.position.set(bx - n.x*side*1.4, p.y+4.46, bz - n.z*side*1.4);
    tmpL.lookAt(p.x, p.y+4.46, p.z);
    tmpL.updateMatrix();
    headGeos.push(headG.clone().applyMatrix4(tmpL.matrix));
    headPositions.push(new THREE.Vector3(bx - n.x*side*1.4, p.y+4.46, bz - n.z*side*1.4));
    tmpL.position.set(bx - n.x*side*1.4, p.y+0.12, bz - n.z*side*1.4);
    tmpL.rotation.set(-Math.PI/2, 0, 0);
    tmpL.updateMatrix();
    poolGeos.push(poolG.clone().applyMatrix4(tmpL.matrix));
  }
  scene.add(new THREE.Mesh(mergeGeometries(poleGeos), poleM));
  const lampHeadMesh = new THREE.Mesh(mergeGeometries(headGeos), env.lampHeadM);
  // 注意：灯头 box 本体不再单独进 bloom，避免方块边缘被放大成生硬过曝方块。
  // 改由下方面向相机的柔光晕 sprite 承担夜间发光观感（圆形软光，无方块边缘）。
  scene.add(lampHeadMesh);
  // —— 灯头柔光晕：每个灯头叠加一个面向相机的 billboard glow sprite（圆形软光）
  const lampGlowTex = makeGlowTex([[0,'rgba(255,238,200,0.95)'],[0.25,'rgba(255,224,165,0.55)'],[0.55,'rgba(255,210,140,0.18)'],[1,'rgba(255,200,120,0)']]);
  env.lampGlowMat = new THREE.SpriteMaterial({map:lampGlowTex, transparent:true, opacity:0, color:0xffe8b8, blending:THREE.AdditiveBlending, depthWrite:false, fog:false});
  env.lampGlows = new THREE.Group();
  for (const hp of headPositions) {
    const sp = new THREE.Sprite(env.lampGlowMat);
    sp.position.copy(hp);
    sp.scale.set(2.2, 2.2, 1);
    sp.layers.enable(BLOOM_LAYER); // 柔光晕进 selective bloom，bloom 在圆形软光上扩散自然
    env.lampGlows.add(sp);
  }
  env.lampGlows.visible = false;
  scene.add(env.lampGlows);
  env.lampPools = new THREE.Mesh(mergeGeometries(poolGeos), poolM);
  env.lampPools.layers.enable(BLOOM_LAYER); // 灯光池进 selective bloom
  scene.add(env.lampPools);
  env.lampPools.visible = false;

  // —— 漂移云层：多絮团簇（替代单张大贴片，体积感更真实）
  const cloudTex = makeGlowTex([[0,'rgba(255,255,255,0.75)'],[0.4,'rgba(255,255,255,0.32)'],[0.75,'rgba(255,255,255,0.10)'],[1,'rgba(255,255,255,0)']]);
  env.cloudMat = new THREE.SpriteMaterial({map:cloudTex, transparent:true, opacity:0.55, color:0xffbe92, depthWrite:false, fog:false});
  env.clouds = [];
  for (let i = 0; i < 10; i++) {
    const grp = new THREE.Group();
    const a = Math.random()*Math.PI*2, r = 550 + Math.random()*900;
    grp.position.set(Math.cos(a)*r, 190 + Math.random()*170, Math.sin(a)*r);
    const s = 220 + Math.random()*260;
    const puffs = 4 + Math.floor(Math.random()*3);
    for (let p = 0; p < puffs; p++) {
      const sp = new THREE.Sprite(env.cloudMat);
      const ps = s*(0.45 + Math.random()*0.4);
      sp.scale.set(ps, ps*0.42, 1);
      sp.position.set((Math.random()-0.5)*s*1.3, (Math.random()-0.5)*s*0.16, (Math.random()-0.5)*s*0.25);
      grp.add(sp);
    }
    grp.userData.vx = 1.2 + Math.random()*1.8;
    scene.add(grp);
    env.clouds.push(grp);
  }

  // —— 月亮
  const moonTex = makeGlowTex([[0,'rgba(245,250,255,1)'],[0.30,'rgba(235,242,255,1)'],[0.38,'rgba(190,210,255,0.35)'],[1,'rgba(160,190,255,0)']]);
  env.moon = new THREE.Sprite(new THREE.SpriteMaterial({map:moonTex, transparent:true, fog:false, depthWrite:false}));
  env.moon.scale.set(230, 230, 1);
  env.moon.visible = false;
  scene.add(env.moon);

  // —— 灯塔（海角处，夜间旋转光束）
  let li = 0, lr = 0;
  for (let i = 0; i < NS; i += 10) {
    const d = Math.hypot(samples[i].x, samples[i].z);
    if (d > lr) { lr = d; li = i; }
  }
  const lp = samples[li], ln = normals[li];
  const sideH = islandBase(lp.x + ln.x*30, lp.z + ln.z*30) < islandBase(lp.x - ln.x*30, lp.z - ln.z*30) ? 1 : -1;
  const lx = lp.x + ln.x*sideH*26, lz = lp.z + ln.z*sideH*26;
  const ly = Math.max(islandBase(lx, lz), 1.0);
  const lhouse = new THREE.Group();
  const towerM = new THREE.MeshStandardMaterial({color:0xe8e4dc, roughness:0.85});
  const redM = new THREE.MeshStandardMaterial({color:0xb3382e, roughness:0.7});
  env.lanternM = new THREE.MeshStandardMaterial({color:0xfff3c0, emissive:0xffe9a0, emissiveIntensity:0.15});
  const t1 = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 2.1, 9, 12), towerM);
  t1.position.y = 4.5; t1.castShadow = true; lhouse.add(t1);
  const t2 = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.35, 3, 12), redM);
  t2.position.y = 10.5; lhouse.add(t2);
  const lant = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 1.6, 10), env.lanternM);
  lant.position.y = 12.8; lant.layers.enable(BLOOM_LAYER); lhouse.add(lant); // 灯笼进 bloom
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.3, 1.5, 10), redM);
  roof.position.y = 14.3; lhouse.add(roof);
  env.beamGrp = new THREE.Group();
  env.beamGrp.position.y = 12.8;
  const beamG = new THREE.ConeGeometry(2.6, 55, 10, 1, true);
  beamG.translate(0, -27.5, 0);
  beamG.rotateX(Math.PI/2);
  const beamM = new THREE.MeshBasicMaterial({color:0xfff0b0, transparent:true, opacity:0.16, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide, fog:false});
  const b1 = new THREE.Mesh(beamG, beamM); b1.layers.enable(BLOOM_LAYER);
  const b2 = new THREE.Mesh(beamG, beamM); b2.layers.enable(BLOOM_LAYER);
  b2.rotation.y = Math.PI;
  env.beamGrp.add(b1); env.beamGrp.add(b2);
  env.beamGrp.visible = false;
  lhouse.add(env.beamGrp);
  lhouse.position.set(lx, ly, lz);
  scene.add(lhouse);
  env.lhPos = {x: lx, z: lz}; // 供玩法系统放置碰撞体/道具

  // —— 萤火虫（夜间）
  const FN = 160, fpos = new Float32Array(FN*3);
  let fi = 0, fguard = 0;
  while (fi < FN && fguard++ < 2000) {
    const a = Math.random()*Math.PI*2, r = 60 + Math.random()*440;
    const x = Math.cos(a)*r, z = Math.sin(a)*r;
    const h = meshGroundHeight(x, z);
    if (h < 1 || h > 16) continue;
    fpos[fi*3] = x; fpos[fi*3+1] = h + 0.5 + Math.random()*2.2; fpos[fi*3+2] = z;
    fi++;
  }
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.BufferAttribute(fpos, 3));
  env.fireflies = new THREE.Points(fg, new THREE.PointsMaterial({color:0xa6ff5e, size:0.32, transparent:true, opacity:0.8, blending:THREE.AdditiveBlending, depthWrite:false}));
  env.fireflies.layers.enable(BLOOM_LAYER); // 萤火虫进 selective bloom
  env.fireflies.visible = false;
  scene.add(env.fireflies);

  // —— 路旁草丛（实例化）
  const g1 = new THREE.PlaneGeometry(0.85, 0.5);
  g1.translate(0, 0.25, 0);
  const g2 = g1.clone();
  g2.rotateY(Math.PI/2);
  const gg = mergeGeometries([g1, g2]);
  const gm = new THREE.MeshLambertMaterial({color:0xffffff, map: bladeTexture(), alphaTest: 0.45, side: THREE.DoubleSide});
  const GCOUNT = 1000;
  const inst = new THREE.InstancedMesh(gg, gm, GCOUNT);
  const dummy = new THREE.Object3D();
  const gc = new THREE.Color();
  let gi = 0, gguard = 0;
  while (gi < GCOUNT && gguard++ < 9000) {
    const si = Math.floor(Math.random()*NS);
    const p = samples[si], n = normals[si];
    const side = Math.random() < 0.5 ? 1 : -1;
    const off = 9 + Math.random()*32;
    const x = p.x + n.x*side*off, z = p.z + n.z*side*off;
    if (branchInfo(x, z).dist < 9) continue;
    const h = meshGroundHeight(x, z); // 贴渲染网格
    if (h < 1 || h > 16) continue;
    // 陡坡跳过 + 下沉锚地，避免低面数地形上的悬浮草块
    const slope = Math.abs(groundHeight(x+5, z) - groundHeight(x-5, z))
                + Math.abs(groundHeight(x, z+5) - groundHeight(x, z-5));
    if (slope > 3) continue;
    dummy.position.set(x, h - 0.12, z);
    dummy.rotation.y = Math.random()*Math.PI;
    dummy.scale.setScalar(0.55 + Math.random()*0.6);
    dummy.updateMatrix();
    inst.setMatrixAt(gi, dummy.matrix);
    gc.setHSL(0.26 + Math.random()*0.06, 0.45, 0.20 + Math.random()*0.10);
    inst.setColorAt(gi, gc);
    gi++;
  }
  inst.count = gi;
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  scene.add(inst);

  // —— 远山 / 远岛剪影（三层深度：近岛暗色 → 中远山 → 极远山淡色）
  // 近岛群（800-1200m）：较暗、较清晰
  const nearIsleM = new THREE.MeshStandardMaterial({color:0x3a4458, roughness:1, fog:true});
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI * 2 / 6 + Math.random() * 0.6;
    const r = 800 + Math.random() * 400;
    const w = 80 + Math.random() * 120;
    const h = 18 + Math.random() * 28;
    const geo = new THREE.ConeGeometry(w, h, 5 + Math.floor(Math.random() * 4));
    // 顶点扰动：让锥体更像自然山脊
    const pos = geo.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      if (pos.getY(v) < h * 0.4) {
        pos.setX(v, pos.getX(v) + (Math.random() - 0.5) * w * 0.3);
        pos.setZ(v, pos.getZ(v) + (Math.random() - 0.5) * w * 0.3);
      }
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    const isle = new THREE.Mesh(geo, nearIsleM);
    isle.position.set(Math.cos(a) * r, -6, Math.sin(a) * r);
    isle.rotation.y = Math.random() * Math.PI * 2;
    scene.add(isle);
  }
  // 中远山脊（1400-2000m）：中等色调、模糊
  const midRidgeM = new THREE.MeshStandardMaterial({color:0x556078, roughness:1, fog:true});
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI * 2 / 8 + Math.random() * 0.4;
    const r = 1400 + Math.random() * 600;
    const w = 120 + Math.random() * 200;
    const h = 30 + Math.random() * 50;
    // 多峰山脊：合并 2-3 个锥体
    const group = new THREE.Group();
    const peaks = 2 + Math.floor(Math.random() * 2);
    for (let p = 0; p < peaks; p++) {
      const pw = w * (0.6 + Math.random() * 0.5);
      const ph = h * (0.7 + Math.random() * 0.4);
      const peak = new THREE.Mesh(new THREE.ConeGeometry(pw, ph, 6), midRidgeM);
      peak.position.set((Math.random() - 0.5) * w * 0.8, ph * 0.3, (Math.random() - 0.5) * w * 0.4);
      group.add(peak);
    }
    group.position.set(Math.cos(a) * r, -8, Math.sin(a) * r);
    group.rotation.y = Math.random() * Math.PI * 2;
    scene.add(group);
  }
  // 极远山（2500-3500m）：淡色、几乎融入雾中
  const farMtnM = new THREE.MeshStandardMaterial({color:0x7a8598, roughness:1, fog:true, transparent:true, opacity:0.6});
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI * 2 / 12 + Math.random() * 0.3;
    const r = 2500 + Math.random() * 1000;
    const w = 200 + Math.random() * 350;
    const h = 40 + Math.random() * 80;
    const mtn = new THREE.Mesh(new THREE.ConeGeometry(w, h, 5), farMtnM);
    mtn.position.set(Math.cos(a) * r, -12, Math.sin(a) * r);
    mtn.rotation.y = Math.random() * Math.PI * 2;
    scene.add(mtn);
  }

  // —— 海岸礁石群（沿岛岸线程序化散布）
  const reefM = new THREE.MeshStandardMaterial({color:0x4a4a42, roughness:0.9, metalness:0.05});
  for (let i = 0; i < 60; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 580 + Math.random() * 100; // 岛岸线约 600-680m
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const h = islandBase(x, z);
    if (h < -2 || h > 3) continue; // 只放在水线附近
    // 多块礁石组合
    const cluster = new THREE.Group();
    const rocks = 2 + Math.floor(Math.random() * 3);
    for (let r2 = 0; r2 < rocks; r2++) {
      const rw = 1.5 + Math.random() * 4;
      const rh = 1 + Math.random() * 3;
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(rw, 0),
        reefM
      );
      rock.scale.set(1, rh / rw, 1);
      rock.position.set((Math.random() - 0.5) * 4, rh * 0.3, (Math.random() - 0.5) * 4);
      rock.rotation.set(Math.random() * 0.5, Math.random() * Math.PI, Math.random() * 0.5);
      rock.castShadow = true;
      cluster.add(rock);
    }
    cluster.position.set(x, Math.max(h, -0.5) - 0.3, z);
    scene.add(cluster);
  }

  // —— 路肩碎石带（程序化纹理石头，非低多面体）
  // 石头贴图：canvas 生成自然岩石纹理
  function stoneTexture() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const cx = cv.getContext('2d');
    // 底色：灰棕色
    cx.fillStyle = '#7a7268';
    cx.fillRect(0, 0, 64, 64);
    // 噪点：模拟岩石颗粒
    for (let i = 0; i < 400; i++) {
      const x = Math.random() * 64, y = Math.random() * 64;
      const s = 1 + Math.random() * 3;
      const v = 80 + Math.random() * 80 | 0;
      cx.fillStyle = `rgba(${v},${v - 10},${v - 20},${0.3 + Math.random() * 0.4})`;
      cx.fillRect(x, y, s, s);
    }
    // 裂纹/暗斑
    for (let i = 0; i < 8; i++) {
      cx.strokeStyle = `rgba(${40 + Math.random()*30|0},${35 + Math.random()*25|0},${30 + Math.random()*20|0},${0.3 + Math.random() * 0.3})`;
      cx.lineWidth = 0.5 + Math.random() * 1;
      cx.beginPath();
      cx.moveTo(Math.random() * 64, Math.random() * 64);
      cx.lineTo(Math.random() * 64, Math.random() * 64);
      cx.stroke();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  // 石头几何：扰动的十二面体（更自然的形状）
  function stoneGeometry() {
    const g = new THREE.DodecahedronGeometry(0.2, 1); // detail 1 = 更多面
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      // 随机扰动顶点：打破规则几何感
      pos.setX(i, pos.getX(i) * (0.7 + Math.random() * 0.6));
      pos.setY(i, pos.getY(i) * (0.5 + Math.random() * 0.5)); // 压扁
      pos.setZ(i, pos.getZ(i) * (0.7 + Math.random() * 0.6));
    }
    g.computeVertexNormals();
    return g;
  }

  const stoneMat = new THREE.MeshStandardMaterial({
    map: stoneTexture(),
    roughness: 0.92,
    metalness: 0.02,
    color: 0x998877
  });
  const shoulderGeo = stoneGeometry();
  const shoulderCount = 2000;
  const shoulderInst = new THREE.InstancedMesh(shoulderGeo, stoneMat, shoulderCount);
  const sDummy = new THREE.Object3D();
  let si = 0;
  for (let i = 0; i < NS && si < shoulderCount; i += 2) {
    const s = samples[i];
    const n = normals[i];
    for (const side of [-1, 1]) {
      if (si >= shoulderCount) break;
      if (Math.random() > 0.6) continue;
      const off = HALF_W + 1.1 + Math.random() * 2.5;
      const x = s.x + n.x * side * off;
      const z = s.z + n.z * side * off;
      const h = meshGroundHeight(x, z);
      if (h < 0.3) continue;
      sDummy.position.set(x, h - 0.06, z);
      sDummy.rotation.set(Math.random() * 0.5, Math.random() * Math.PI * 2, Math.random() * 0.3);
      const ss = 0.5 + Math.random() * 1.0;
      sDummy.scale.set(ss, ss * (0.4 + Math.random() * 0.6), ss); // 扁平化
      sDummy.updateMatrix();
      shoulderInst.setMatrixAt(si, sDummy.matrix);
      si++;
    }
  }
  shoulderInst.count = si;
  shoulderInst.instanceMatrix.needsUpdate = true;
  shoulderInst.castShadow = true;
  shoulderInst.receiveShadow = true;
  scene.add(shoulderInst);

  // —— 多层雾化带：创造远景树线的大气透视层次
  // 创建渐变纹理：底部不透明→顶部透明（模拟地面雾）
  function makeHazeTexture(baseColor, topAlpha) {
    const cv = document.createElement('canvas');
    cv.width = 4; cv.height = 64;
    const cx = cv.getContext('2d');
    const r = (baseColor >> 16) & 0xff, g2 = (baseColor >> 8) & 0xff, b = baseColor & 0xff;
    const grad = cx.createLinearGradient(0, 63, 0, 0);
    grad.addColorStop(0, `rgba(${r},${g2},${b},0.6)`);
    grad.addColorStop(0.3, `rgba(${r},${g2},${b},0.35)`);
    grad.addColorStop(0.7, `rgba(${r},${g2},${b},${topAlpha * 0.5})`);
    grad.addColorStop(1, `rgba(${r},${g2},${b},0)`);
    cx.fillStyle = grad;
    cx.fillRect(0, 0, 4, 64);
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = THREE.RepeatWrapping;
    return tex;
  }

  // 四层雾化带：近→远，由浓到淡
  const hazeLayers = [
    { r: 350,  h: 35, color: 0x8899aa, opacity: 0.20, topA: 0.08 },  // 近景树线雾
    { r: 700,  h: 50, color: 0x8a9ab0, opacity: 0.28, topA: 0.10 },  // 中景雾
    { r: 1500, h: 70, color: 0x8a9ab0, opacity: 0.35, topA: 0.12 },  // 远景雾
    { r: 2800, h: 100, color: 0x9aabbf, opacity: 0.30, topA: 0.08 }, // 地平线雾
  ];
  for (const l of hazeLayers) {
    const geo = new THREE.CylinderGeometry(l.r, l.r, l.h, 48, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      map: makeHazeTexture(l.color, l.topA),
      transparent: true, opacity: l.opacity,
      side: THREE.BackSide, depthWrite: false, fog: false
    });
    const ring = new THREE.Mesh(geo, mat);
    ring.position.y = l.h * 0.15; // 底部贴近地面
    scene.add(ring);
  }
}

// ---------- 时间切换 ----------
function applyTod(name) {
  G.curTod = name;
  const P = PRESETS[name];
  curSunDir.set(...P.sunDir).normalize();
  skyU.turbidity.value = P.turbidity;
  skyU.rayleigh.value = P.rayleigh;
  skyU.mieCoefficient.value = P.mieC;
  skyU.mieDirectionalG.value = P.mieG;
  skyU.sunPosition.value.set(...P.skySun).normalize();
  sun.color.setHex(P.sunCol);
  sun.intensity = P.sunInt;
  hemi.intensity = P.hemiInt;
  hemi.color.setHex(P.hemiSky);
  // 轮廓补光跟随天光：强度压低、色温与天空一致，不再是独立的"假光"
  rim.intensity = name === 'night' ? 0.12 : 0.45;
  rim.color.setHex(name === 'night' ? 0x6f82a8 : name === 'day' ? 0xcfe0f5 : 0xe8b9a0);
  renderer.toneMappingExposure = P.exposure;
  scene.fog.color.setHex(P.fog);
  bloomPass.strength = G.hiQuality ? P.bloom : 0;
  stars.visible = (name === 'night');
  if (G.waterOK && oceanUniforms) {
    oceanUniforms.deepColor.value.setHex(P.water);
    oceanUniforms.shallowColor.value.setHex(P.water).offsetHSL(0.05, 0.15, 0.20);
    oceanUniforms.horizonColor.value.setHex(P.water).offsetHSL(-0.02, -0.05, 0.10);
  }
  // 车灯
  for (const h of G.headlights) h.intensity = P.lights ? 600 : 0;
  // 环境元素昼夜联动（环境可能尚未构建完成，需判空）
  if (env.lampHeadM) {
    const night = name === 'night';
    // 灯头 box 本体夜间适度发光即可（不再拉到 2.2 过曝成方块），柔光晕承担主要发光观感
    env.lampHeadM.emissiveIntensity = night ? 0.9 : 0.12;
    env.lampPools.visible = night;
    if (env.lampGlows) { env.lampGlows.visible = night; env.lampGlowMat.opacity = night ? 0.95 : 0; }
    env.moon.visible = night;
    if (night) env.moon.position.set(curSunDir.x*1700, Math.max(curSunDir.y*1700, 320), curSunDir.z*1700);
    env.fireflies.visible = night;
    env.beamGrp.visible = night;
    env.lanternM.emissiveIntensity = night ? 2.4 : 0.15;
    env.cloudMat.color.setHex(name === 'sunset' ? 0xffbe92 : name === 'day' ? 0xffffff : 0x38445f);
    env.cloudMat.opacity = name === 'day' ? 0.88 : name === 'sunset' ? 0.8 : 0.45;
  }
  for (const m of G.lampMats) {
    if (P.lights) { m.emissive.setHex(0xfff4e0); m.emissiveIntensity = 1.7; }
    else { m.emissive.copy(m.userData?.origEmissive || new THREE.Color(0)); m.emissiveIntensity = m.userData?.origEI ?? 1; }
  }
  applySkyForTod();
}


export { PRESETS, curSunDir, NS, samples, tangents, normals, HALF_W, garageIdx, nearestRoad, islandBase, groundHeight, meshGroundHeight, surfaceHeight, branchInfo, B_HALF, BRANCH_A, BRANCH_B, bSamples, bNormals, bBridge, env, fallbackOcean, sky, stars, oceanUniforms, buildTerrain, buildRoad, buildScenery, buildEnv, applyTod };
