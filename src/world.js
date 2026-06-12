import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, scene, renderer, sun, hemi, rim, sunDir, bloomPass } from './core.js';

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
const ctrl = [];
for (let i = 0; i < 12; i++) {
  const a = i/12 * Math.PI*2;
  const r = 310 + 100*Math.sin(a*2.3+1.0) + 55*Math.sin(a*3.7+0.3);
  const y = 13 + 8*Math.sin(a*2+0.5) + 5*Math.sin(a*3.1+1.2);
  ctrl.push(new THREE.Vector3(Math.cos(a)*r, Math.max(y,3.5), Math.sin(a)*r));
}
const curve = new THREE.CatmullRomCurve3(ctrl, true, 'catmullrom', 0.55);
const NS = 800, samples = [], tangents = [], normals = [];
for (let i = 0; i < NS; i++) {
  const t = i/NS;
  samples.push(curve.getPointAt(t));
  const tg = curve.getTangentAt(t);
  tangents.push(tg);
  normals.push(new THREE.Vector3(-tg.z, 0, tg.x).normalize());
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
  const base = islandBase(x, z);
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
  // 桥判定必须与"主路压平后的地面"比较——路口附近地形被主路抬升过，
  // 用原始地形会把汇入口误判成桥，凭空生成横穿路面的幽灵护栏/空气墙
  function gMain(x, z) {
    const nr2 = nearestRoad(x, z);
    const ry2 = roadYAt(x, z, nr2.idx);
    const base2 = islandBase(x, z);
    if (nr2.dist < 15) return ry2;
    if (nr2.dist < 60) {
      const t2 = THREE.MathUtils.smoothstep(nr2.dist, 15, 60);
      return ry2*(1-t2) + base2*t2;
    }
    return base2;
  }
  const rawB = [];
  for (let i = 0; i <= NB; i++) {
    const t = i/NB;
    const p = bc.getPointAt(t);
    const tg = bc.getTangentAt(t);
    bSamples.push(p);
    bTangents.push(tg);
    bNormals.push(new THREE.Vector3(-tg.z, 0, tg.x).normalize());
    rawB.push(i > 25 && i < NB - 25 && p.y - gMain(p.x, p.z) > 3);
  }
  // 桥段必须连续 ≥14 个采样，去除碎片护栏
  for (let i = 0; i <= NB; i++) bBridge.push(false);
  let runStart = -1;
  for (let i = 0; i <= NB + 1; i++) {
    const v = i <= NB ? rawB[i] : false;
    if (v && runStart < 0) runStart = i;
    if (!v && runStart >= 0) {
      const len = i - runStart;
      if (len >= 14) for (let j = runStart; j < i; j++) bBridge[j] = true;
      runStart = -1;
    }
  }
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
  const g = 201, st = 9.5;
  const gx = (x + 950)/st, gz = (z + 950)/st;
  if (gx < 0 || gz < 0 || gx >= 200 || gz >= 200) return groundHeight(x, z);
  const ix = Math.floor(gx), iz = Math.floor(gz);
  const fx2 = gx - ix, fz2 = gz - iz;
  const h00 = terrainField[iz*g+ix], h10 = terrainField[iz*g+ix+1];
  const h01 = terrainField[(iz+1)*g+ix], h11 = terrainField[(iz+1)*g+ix+1];
  return h00*(1-fx2)*(1-fz2) + h10*fx2*(1-fz2) + h01*(1-fx2)*fz2 + h11*fx2*fz2;
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
  const SEG = 200, SIZE = 1900;
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
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  terrainField = field;
  g.computeVertexNormals();
  // 三层细节贴图：草/沙/岩按地形高度混合（splat），顶点色提供大尺度色调
  const mat = new THREE.MeshStandardMaterial({vertexColors:true, map: terrainGrassTex(), roughness:0.95, metalness:0, envMapIntensity:0.35});
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tSand = { value: terrainSandTex() };
    shader.uniforms.tRock = { value: terrainRockTex() };
    shader.vertexShader = 'varying float vTerrY;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n  vTerrY = position.y;'
    );
    shader.fragmentShader = 'uniform sampler2D tSand;\nuniform sampler2D tRock;\nvarying float vTerrY;\n' + shader.fragmentShader.replace(
      '#include <map_fragment>',
      [
        'vec2 sUv = vMapUv * 90.0;',
        'vec3 cG = texture2D(map, sUv).rgb;',
        'vec3 cS = texture2D(tSand, sUv).rgb;',
        'vec3 cR = texture2D(tRock, sUv * 0.6).rgb;',
        'float wS = 1.0 - smoothstep(1.2, 4.0, vTerrY);',
        'float wR = smoothstep(13.0, 21.0, vTerrY);',
        'float wG = max(0.0, 1.0 - wS - wR);',
        'diffuseColor.rgb *= (cG*wG + cS*wS + cR*wR) * 1.18;'
      ].join('\n')
    );
  };
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  scene.add(m);
}

// ---------- 海洋 ----------
const fallbackOcean = new THREE.Mesh(
  new THREE.PlaneGeometry(5200, 5200),
  new THREE.MeshStandardMaterial({color:0x0d3b52, roughness:0.15, metalness:0.1, envMapIntensity:1.3})
);
fallbackOcean.rotation.x = -Math.PI/2;
fallbackOcean.visible = false;
scene.add(fallbackOcean);
new THREE.TextureLoader().load(
  'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/textures/waternormals.jpg',
  (tex) => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    G.water = new Water(new THREE.PlaneGeometry(5200, 5200), {
      textureWidth: 512, textureHeight: 512,
      waterNormals: tex,
      sunDirection: curSunDir.clone(),
      sunColor: 0xffaa66,
      waterColor: 0x06283a,
      distortionScale: 3.2,
      fog: true
    });
    G.water.rotation.x = -Math.PI/2;
    scene.add(G.water);
    G.waterOK = true;
    G.water.visible = G.hiQuality;
    fallbackOcean.visible = !G.hiQuality;
    applyTod(G.curTod); // 同步当前预设的水面颜色
  },
  undefined,
  () => { fallbackOcean.visible = true; }
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
  const roadMat = new THREE.MeshStandardMaterial({map:asphaltTex, color:0xffffff, roughness:0.85, metalness:0, envMapIntensity:0.5});
  const shoulderMat = new THREE.MeshStandardMaterial({color:0x615a50, roughness:1});
  const lineMat = new THREE.MeshStandardMaterial({color:0xdadada, roughness:0.85, emissive:0x0a0a0a});
  const dashMat = new THREE.MeshStandardMaterial({color:0xe8c44a, roughness:0.85, emissive:0x141000});
  function ribbon(off1, off2, yLift, mat) {
    const pts = [], uvs = [];
    for (let i = 0; i <= NS; i++) {
      const k = i % NS, p = samples[k], n = normals[k];
      pts.push(p.x + n.x*off1, p.y + yLift, p.z + n.z*off1,
               p.x + n.x*off2, p.y + yLift, p.z + n.z*off2);
      uvs.push(0, i*0.5, 1, i*0.5);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    const idx = [];
    for (let i = 0; i < NS; i++) { const a = i*2; idx.push(a, a+1, a+2, a+1, a+3, a+2); }
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    return m;
  }
  scene.add(ribbon(-HALF_W, HALF_W, 0.05, roadMat));
  scene.add(ribbon(-HALF_W-1.1, -HALF_W, 0.03, shoulderMat));
  scene.add(ribbon(HALF_W, HALF_W+1.1, 0.03, shoulderMat));
  scene.add(ribbon(-HALF_W+0.45, -HALF_W+0.62, 0.07, lineMat));
  scene.add(ribbon(HALF_W-0.62, HALF_W-0.45, 0.07, lineMat));
  const dashPts = [], dashIdx = [];
  let vi = 0;
  for (let i = 0; i < NS; i++) {
    if (i % 10 >= 5) continue;
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
  function branchRibbon(off1, off2, yLift, mat) {
    const pts = [], uvs = [], idx = [];
    for (let i = 0; i < bSamples.length; i++) {
      const p = bSamples[i], n = bNormals[i];
      pts.push(p.x + n.x*off1, p.y + yLift, p.z + n.z*off1,
               p.x + n.x*off2, p.y + yLift, p.z + n.z*off2);
      uvs.push(0, i*0.5, 1, i*0.5);
      if (i < bSamples.length - 1) { const a = i*2; idx.push(a, a+1, a+2, a+1, a+3, a+2); }
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
  scene.add(branchRibbon(-B_HALF, B_HALF, 0.07, roadMat));
  scene.add(branchRibbon(-B_HALF + 0.4, -B_HALF + 0.55, 0.09, lineMat));
  scene.add(branchRibbon(B_HALF - 0.55, B_HALF - 0.4, 0.09, lineMat));
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
  const treeSpots = [];
  // 棕榈/岩石全部烘焙合并（原来每棵棕榈 7 个网格 → 全岛共 3 个网格）
  const trunkGeos = [], palmLeafGeos = [], rockGeos = [];
  const tmpO = new THREE.Object3D();
  let placed = 0, guard = 0;
  while (placed < 520 && guard++ < 6000) {
    const a = Math.random()*Math.PI*2, r = 60 + Math.random()*520;
    const x = Math.cos(a)*r, z = Math.sin(a)*r;
    if (nearestRoad(x, z).dist < 16 || branchInfo(x, z).dist < 14) continue;
    const h = groundHeight(x, z);
    if (h < 0.6 || h > 20) continue;
    // 坡度过滤：低面数地形在陡坡上与解析高度有偏差，避免悬浮
    const slope = Math.abs(groundHeight(x+5, z) - groundHeight(x-5, z))
                + Math.abs(groundHeight(x, z+5) - groundHeight(x, z-5));
    if (slope > 4) continue;
    if (h >= 3.5 && Math.random() < 0.85) {
      // 收集 EZ-Tree 种植点：高处松树、低处阔叶、部分灌木
      let vi;
      const rv = Math.random();
      if (rv < 0.16) vi = 7 + (Math.random() < 0.5 ? 0 : 1);          // 灌木
      else if (h > 12) vi = Math.random() < 0.6 ? 6 : 5;              // 高地大松/松
      else if (h > 8) vi = [1, 5, 0][Math.floor(Math.random()*3)];    // 大橡/松/橡
      else vi = [0, 2, 3, 4][Math.floor(Math.random()*4)];            // 阔叶混交
      treeSpots.push({x, z, h, vi, rot: Math.random()*Math.PI*2, s: 0.75 + Math.random()*0.55});
      placed++;
      continue;
    }
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
    } else {
      tmpO.position.set(x, h, z);
      tmpO.rotation.set(Math.random(), Math.random()*3, Math.random());
      tmpO.scale.setScalar(0.6 + Math.random()*1.6);
      tmpO.updateMatrix();
      rockGeos.push(rockG.clone().applyMatrix4(tmpO.matrix));
      tmpO.scale.setScalar(1);
    }
    placed++;
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
      const h = groundHeight(x, z);
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
  scatter(crossG, flowerM, 800, { minRoad: 8, hMin: 3, hMax: 14, s0: 1.0, s1: 1.0, sink: 0.04,
    color: (c) => c.setHSL([0.95, 0.13, 0.0, 0.78][Math.floor(Math.random()*4)], 0.7, 0.66) }); // 花簇
  scatter(reedG, reedM2, 500, { minRoad: 9, hMin: 0.8, hMax: 2.8, s0: 0.8, s1: 1.0, ys: 1.2, sink: 0.06,
    color: (c) => c.setHSL(0.13 + Math.random()*0.04, 0.42, 0.34 + Math.random()*0.12) }); // 芦苇/滨草
  const reefG = new THREE.DodecahedronGeometry(1, 0);
  const reefM = new THREE.MeshStandardMaterial({color:0xffffff, roughness:0.9, flatShading:true});
  scatter(reefG, reefM, 120, { minRoad: 12, hMin: -0.2, hMax: 1.0, s0: 0.5, s1: 1.1, ys: 0.6, sink: 0.3,
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
}

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
    tmpL.position.set(bx - n.x*side*1.4, p.y+0.12, bz - n.z*side*1.4);
    tmpL.rotation.set(-Math.PI/2, 0, 0);
    tmpL.updateMatrix();
    poolGeos.push(poolG.clone().applyMatrix4(tmpL.matrix));
  }
  scene.add(new THREE.Mesh(mergeGeometries(poleGeos), poleM));
  scene.add(new THREE.Mesh(mergeGeometries(headGeos), env.lampHeadM));
  env.lampPools = new THREE.Mesh(mergeGeometries(poolGeos), poolM);
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
  lant.position.y = 12.8; lhouse.add(lant);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.3, 1.5, 10), redM);
  roof.position.y = 14.3; lhouse.add(roof);
  env.beamGrp = new THREE.Group();
  env.beamGrp.position.y = 12.8;
  const beamG = new THREE.ConeGeometry(2.6, 55, 10, 1, true);
  beamG.translate(0, -27.5, 0);
  beamG.rotateX(Math.PI/2);
  const beamM = new THREE.MeshBasicMaterial({color:0xfff0b0, transparent:true, opacity:0.16, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide, fog:false});
  const b1 = new THREE.Mesh(beamG, beamM);
  const b2 = new THREE.Mesh(beamG, beamM);
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
    const h = groundHeight(x, z);
    if (h < 1 || h > 16) continue;
    fpos[fi*3] = x; fpos[fi*3+1] = h + 0.5 + Math.random()*2.2; fpos[fi*3+2] = z;
    fi++;
  }
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.BufferAttribute(fpos, 3));
  env.fireflies = new THREE.Points(fg, new THREE.PointsMaterial({color:0xa6ff5e, size:0.32, transparent:true, opacity:0.8, blending:THREE.AdditiveBlending, depthWrite:false}));
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
    const h = groundHeight(x, z);
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

  // —— 远岛剪影（雾中层次）
  const isleM = new THREE.MeshStandardMaterial({color:0x46526c, roughness:1});
  for (let i = 0; i < 4; i++) {
    const a = Math.PI*0.3 + i*1.45 + Math.random()*0.5;
    const r = 1050 + Math.random()*450;
    const isle = new THREE.Mesh(new THREE.ConeGeometry(110 + Math.random()*130, 26 + Math.random()*36, 7), isleM);
    isle.position.set(Math.cos(a)*r, -4, Math.sin(a)*r);
    isle.rotation.y = Math.random()*3;
    scene.add(isle);
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
  if (G.waterOK) {
    G.water.material.uniforms.waterColor.value.setHex(P.water);
    G.water.material.uniforms.sunDirection.value.copy(curSunDir);
    G.water.material.uniforms.sunColor.value.setHex(name==='night' ? 0x334466 : 0xffaa66);
  }
  fallbackOcean.material.color.setHex(P.water);
  // 车灯
  for (const h of G.headlights) h.intensity = P.lights ? 150 : 0;
  // 环境元素昼夜联动（环境可能尚未构建完成，需判空）
  if (env.lampHeadM) {
    const night = name === 'night';
    env.lampHeadM.emissiveIntensity = night ? 2.2 : 0.12;
    env.lampPools.visible = night;
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
  rebuildEnv();
}


export { PRESETS, curSunDir, NS, samples, tangents, normals, HALF_W, garageIdx, nearestRoad, islandBase, groundHeight, meshGroundHeight, surfaceHeight, branchInfo, B_HALF, BRANCH_A, BRANCH_B, bSamples, bNormals, bBridge, env, fallbackOcean, buildTerrain, buildRoad, buildScenery, buildEnv, applyTod };
