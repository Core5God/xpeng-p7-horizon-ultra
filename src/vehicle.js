import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { G, scene, camera, renderer, wrapPi, BLOOM_LAYER } from './core.js';
import { samples, tangents, normals, garageIdx, nearestRoad, surfaceHeight, groundHeight, branchInfo, bSamples, bNormals, B_HALF, HALF_W, applyTod, env, stars, sky } from './world.js';
import { sfx, skillPop, race, unlockAch, spawnBreakDebris } from './gameplay.js';
import { showMsg, refreshSwatches, saveSettings, keys } from './ui.js';

const GLB_URL = 'assets/e29.glb';
const CAR_R = 0.95; // 车体半宽（胶囊碰撞半径）：碰撞边界 = 视觉护栏位置 - CAR_R

// ---------- 车辆（真实 E29 模型） ----------
// c = 对原厂银色纹理的着色系数（target/silver），sw = 车库色块显示色（采样自官图车漆）
const PAINTS = [
  {name:'新月银', c:0xffffff, sw:0xc3c9d1},
  {name:'微星灰', c:0xc3d1d8, sw:0x97a6b2},
  {name:'星芒蓝', c:0xd3f6f9, sw:0xa3c3cd},
  {name:'星瀚绿', c:0x318166, sw:0x266654},
  {name:'星暮紫', c:0xd7b8c0, sw:0xa6929e},
  {name:'律动黄', c:0xffff54, sw:0xc6d845},
  {name:'星曜红', c:0xe62b39, sw:0xb2222f}
];
const car = new THREE.Group();
scene.add(car);

// —— 车辆反射探针：CubeCamera 把真实周围环境渲染进 cubemap 作为车的环境贴图。
// sunSprite 已删除 + selective bloom 隔离发光体 + 渲染时隐藏高亮对象 → 反射输入干净。
const reflectRT = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
const reflectCam = new THREE.CubeCamera(0.3, 2500, reflectRT);
let _reflN = 0;
export function updateCarReflection() {
  if (!G.carReady) return;
  // 速度自适应更新频率：低速每 32 帧、中速每 16 帧、高速每 8 帧
  const sp = Math.abs(state.speed);
  const interval = sp < 1 ? 32 : sp < 8 ? 16 : 8;
  if ((_reflN++ % interval) !== 0) return;

  // 隐藏高亮 sprite / 光球 / 发光体，防止进入车身 CubeCamera 反射造成脏反射
  const hidden = [];
  function hide(obj) { if (obj && obj.visible) { obj.visible = false; hidden.push(obj); } }
  hide(env?.moon);
  hide(env?.lampPools);
  hide(env?.beamGrp);
  hide(env?.fireflies);
  hide(sky);
  if (stars) hide(stars);
  if (env?.clouds) for (const c of env.clouds) hide(c);

  reflectCam.position.set(state.pos.x, state.pos.y + 1.0, state.pos.z);
  const vis = car.visible; car.visible = false;
  reflectCam.update(renderer, scene);
  car.visible = vis;

  // 恢复所有被隐藏的对象
  for (const obj of hidden) obj.visible = true;
}
const paintMats = [];
const glassMats = [];
let glassSeeThru = false;
function setGlassSeeThru(on) {
  if (on === glassSeeThru) return;
  glassSeeThru = on;
  for (const m of glassMats) {
    if (on) { m.transparent = true; m.opacity = 0.25; m.depthWrite = false; }
    else {
      m.transparent = m.userData.origT;
      m.opacity = m.userData.origO;
      m.depthWrite = m.userData.origDW;
    }
    m.needsUpdate = true;
  }
}
const spinPivots = [], steerPivots = [];
let wheelRadius = 0.36;
// 夜间车灯
for (const sx of [-1, 1]) {
  // 光源点放在保险杠之外（z=2.72），光锥只朝前，不会打亮自身车身
  const sp = new THREE.SpotLight(0xcfe0ff, 0, 120, 0.42, 0.55, 1.5);
  sp.position.set(sx*0.70, 0.72, 2.72);
  const tgt = new THREE.Object3D();
  tgt.position.set(sx*0.85, -0.15, 28);
  car.add(sp); car.add(tgt);
  sp.target = tgt;
  G.headlights.push(sp);
}

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

// —— 金属闪片噪点法线（CarConcept 同款手法）：高密度噪点法线 + 最近邻过滤 → 漆面细闪/金属颗粒感
const flakeNormalTex = (() => {
  const s = 512, cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const cx = cv.getContext('2d'), img = cx.createImageData(s, s);
  for (let i = 0; i < s * s; i++) {
    const flake = Math.random() < 0.6;           // 更多"闪片"像素，强偏转
    const amp = flake ? 150 : 28;
    img.data[i*4]   = 128 + (Math.random() - 0.5) * amp; // 法线 X
    img.data[i*4+1] = 128 + (Math.random() - 0.5) * amp; // 法线 Y
    img.data[i*4+2] = 255;                                // 法线 Z（朝上）
    img.data[i*4+3] = 255;
  }
  cx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(110, 110);                  // 平铺密度（闪片大小）
  t.magFilter = THREE.NearestFilter;       // 近距锐利闪片
  t.minFilter = THREE.NearestMipmapLinearFilter; // 远距用 mip 抑制闪烁
  t.anisotropy = 4;
  return t;
})();
const elLoadFill = document.getElementById('loadfill');
const elLoadText = document.getElementById('loadtext');
loader.load(GLB_URL, (gltf) => {
  const model = gltf.scene;
  // 处理期间把车组归零（单位变换），便于在局部空间精确计算；结束后 settleCarPose 恢复
  car.position.set(0, 0, 0);
  car.rotation.set(0, 0, 0);
  car.updateMatrixWorld(true);
  // 归一化：车长 5.0m、居中
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const scale = 5.0 / Math.max(size.x, size.z);
  model.scale.multiplyScalar(scale);
  const box2 = new THREE.Box3().setFromObject(model);
  const ctr = box2.getCenter(new THREE.Vector3());
  model.position.x -= ctr.x;
  model.position.z -= ctr.z;
  model.position.y -= box2.min.y;
  car.add(model);
  model.updateWorldMatrix(true, true);

  // 材质与阴影
  model.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        m.envMapIntensity = 1.15;
        if (m.name && m.name.startsWith('Mat_E29_Body')) {
          // 车身有两个材质（Mat_E29_Body 带纹理 + Mat_E29_Body.001 纯色），都要染色
          paintMats.push(m);
          // 实时 CubeCamera 反射 + 保守 PBR：sunSprite 已删除、selective bloom 已隔离发光体、
          // CubeCamera 渲染时已隐藏高亮对象 → 反射输入干净，保留环境反射不失真
          m.metalness = 0.88;
          m.roughness = 0.22;
          m.envMapIntensity = 1.45;
          m.envMap = reflectRT.texture;
          if ('clearcoat' in m) {
            m.clearcoat = 1.0;
            m.clearcoatRoughness = 0.08;
          }
          m.normalMap = flakeNormalTex;  // 金属闪片
          m.normalScale.set(0.5, 0.5);   // 明显的金属颗粒闪
          m.needsUpdate = true;
          m.userData.origColor = m.color.clone();
        }
        if (m.name === 'Mat_E29_Lamps') {
          G.lampMats.push(m);
          m.userData.origEmissive = (m.emissive ? m.emissive.clone() : new THREE.Color(0));
          m.userData.origEI = m.emissiveIntensity !== undefined ? m.emissiveIntensity : 1;
          o.layers.enable(BLOOM_LAYER); // 车灯进 selective bloom
        }
        if (m.name === 'Mat_E29_Glass') {
          // 玻璃保留实时 CubeCamera 反射（污染源已清除：sunSprite 删除、发光体隐藏）
          m.envMapIntensity = 1.50;
          m.roughness = 0.05;
          m.envMap = reflectRT.texture;
          m.userData.origT = m.transparent;
          m.userData.origO = m.opacity;
          m.userData.origDW = m.depthWrite;
          glassMats.push(m);
        }
      }
    }
  });

  // 车轮：挂转向/滚动支点（卡钳是独立节点，保持不转）
  const wheels = [];
  model.traverse((o) => { if (o.name && o.name.startsWith('E29_Wheel123')) wheels.push(o); });
  // 按"车轮最低点"贴地：车身包围盒含底盘附件会导致悬浮
  let wheelBottom = Infinity;
  const wb = new THREE.Box3();
  for (const wh of wheels) {
    wb.setFromObject(wh);
    wheelBottom = Math.min(wheelBottom, wb.min.y);
  }
  if (isFinite(wheelBottom)) model.position.y -= wheelBottom + 0.015; // 轻微下压模拟胎压
  model.updateWorldMatrix(true, true);
  // 前轮 = 局部 z 最大的两只（车组此刻为单位变换，世界坐标即局部坐标）
  const infos = wheels.map((wh) => ({ wh, p: wh.getWorldPosition(new THREE.Vector3()) }));
  infos.sort((a, b) => b.p.z - a.p.z);
  infos.forEach((info, idx) => {
    const wbox = new THREE.Box3().setFromObject(info.wh);
    wheelRadius = (wbox.max.y - wbox.min.y) / 2;
    const steer = new THREE.Group();
    steer.position.copy(info.p);
    car.add(steer);
    const spin = new THREE.Group();
    steer.add(spin);
    spin.attach(info.wh);          // 保留世界变换
    spinPivots.push(spin);
    if (idx < 2) steerPivots.push(steer);
  });
  // 尾灯材质克隆：Trunk 贯穿条 + 两侧 BackLens 竖条独立于前灯控制
  {
    const cloneMap = new Map();
    model.traverse((o) => {
      if (o.isMesh && /Lamps_(Trunk|BackLens)/.test(o.name)) {
        if (!cloneMap.has(o.material)) {
          const c = o.material.clone();
          c.userData = Object.assign({}, o.material.userData);
          cloneMap.set(o.material, c);
          rearLampMats.push(c);
          G.lampMats.push(c); // 夜间点亮逻辑继续生效
        }
        o.material = cloneMap.get(o.material);
        o.layers.enable(BLOOM_LAYER); // 尾灯进 selective bloom
      }
    });
  }
  G.carReady = true;
  applySkin(false);
  applyTod(G.curTod);
  settleCarPose(); // 恢复处理期间被归零的车辆姿态
  elLoadText.textContent = 'E29 已就绪 · 鼠标拖动欣赏';
  elLoadFill.style.width = '100%';
  document.getElementById('btnRoam').disabled = false;
  document.getElementById('btnRace').disabled = false;
}, (ev) => {
  if (ev.total) elLoadFill.style.width = Math.round(ev.loaded/ev.total*100) + '%';
}, (err) => {
  elLoadText.textContent = '模型加载失败：' + err;
});

// ---------- 涂装 ----------
function applySkin(announce) {
  if (!paintMats.length) return;
  const P = PAINTS[G.skinIdx];
  const tint = new THREE.Color(P.c);
  for (const m of paintMats) {
    if (G.skinIdx === 0) m.color.copy(m.userData.origColor);
    else m.color.copy(m.userData.origColor).multiply(tint);
  }
  if (announce) showMsg(P.name, 900, 28);
  refreshSwatches();
  saveSettings();
}

// ---------- 物理 ----------
const state = {
  pos: new THREE.Vector3(samples[garageIdx].x, samples[garageIdx].y+0.05, samples[garageIdx].z),
  heading: Math.atan2(tangents[garageIdx].x, tangents[garageIdx].z),
  travel: 0, speed: 0, vx: 0, vz: 0, vyAir: 0, airborne: false, steer: 0, nitro: 1, flow: 0, roll: 0, pitch: 0
};
state.travel = state.heading;

// 让车按地面坡度落稳（车库/静止展示用，消除悬空和穿插）
function settleCarPose() {
  const gy = surfaceHeight(state.pos.x, state.pos.z, state.pos.y);
  state.pos.y = gy;
  const fx = Math.sin(state.heading), fz = Math.cos(state.heading);
  const hF = surfaceHeight(state.pos.x + fx*1.5, state.pos.z + fz*1.5, state.pos.y);
  const hB = surfaceHeight(state.pos.x - fx*1.5, state.pos.z - fz*1.5, state.pos.y);
  const hR = surfaceHeight(state.pos.x + fz*0.9, state.pos.z - fx*0.9, state.pos.y);
  const hL = surfaceHeight(state.pos.x - fz*0.9, state.pos.z + fx*0.9, state.pos.y);
  state.pitch = Math.atan2(hB - hF, 3);
  state.roll = Math.atan2(hR - hL, 1.8);
  car.position.copy(state.pos);
  car.rotation.set(state.pitch, state.heading, state.roll, 'YXZ');
}

// —— NaN 自愈：任何状态量被污染（极端姿态/高度采样异常）都在下一帧入口修复，
// 杜绝"NaN 传染 → 音频赋值抛异常 → 每帧报错且复位无效"的死锁
function sanitizeState() {
  const s = state;
  if (isFinite(s.pos.x + s.pos.y + s.pos.z + s.vx + s.vz + s.speed + s.vyAir +
               s.heading + s.pitch + s.roll + s.steer + s.flow + s.nitro + s.travel)) return;
  if (!isFinite(s.vx)) s.vx = 0;
  if (!isFinite(s.vz)) s.vz = 0;
  if (!isFinite(s.speed)) s.speed = 0;
  if (!isFinite(s.vyAir)) { s.vyAir = 0; s.airborne = false; }
  if (!isFinite(s.steer)) s.steer = 0;
  if (!isFinite(s.pitch)) s.pitch = 0;
  if (!isFinite(s.roll)) s.roll = 0;
  if (!isFinite(s.flow)) s.flow = 0;
  if (!isFinite(s.nitro)) s.nitro = 1;
  if (!isFinite(s.heading)) s.heading = 0;
  if (!isFinite(s.travel)) s.travel = s.heading;
  if (!isFinite(s.pos.x + s.pos.y + s.pos.z)) {
    const px = isFinite(s.pos.x) ? s.pos.x : 0, pz = isFinite(s.pos.z) ? s.pos.z : 0;
    const nr0 = nearestRoad(px, pz);
    s.pos.set(samples[nr0.idx].x, samples[nr0.idx].y + 0.1, samples[nr0.idx].z);
    s.heading = s.travel = Math.atan2(tangents[nr0.idx].x, tangents[nr0.idx].z);
    s.vx = 0; s.vz = 0; s.speed = 0; s.vyAir = 0; s.airborne = false;
  }
}

function physics(dt) {
  sanitizeState();
  const pad = G.pad, padOn = pad.active;
  const fwd = keys['KeyW'] || keys['ArrowUp'] || (padOn && pad.throttle > 0.08);
  const back = keys['KeyS'] || keys['ArrowDown'] || (padOn && pad.brake > 0.08);
  const left = keys['KeyA'] || keys['ArrowLeft'];
  const right = keys['KeyD'] || keys['ArrowRight'];
  const drift = keys['Space'] || (padOn && pad.drift);
  const boost = (keys['ShiftLeft'] || keys['ShiftRight'] || (padOn && pad.boost)) && state.nitro > 0.02 && state.speed > 2;
  const thrAmt = (padOn && pad.throttle > 0.08) ? pad.throttle : 1; // 手柄线性油门

  const nr = nearestRoad(state.pos.x, state.pos.z);
  const bi2 = branchInfo(state.pos.x, state.pos.z);
  const onRoad = nr.dist < HALF_W + 1.2 || bi2.dist < B_HALF + 1.0;
  // FLOW 状态：在路上保持速度持续充能，下道流失；满状态解锁更高动力（技巧驱动极速）
  if (onRoad && Math.abs(state.speed) > 8) state.flow = Math.min(1, state.flow + dt*0.04);
  if (!onRoad) state.flow = Math.max(0, state.flow - dt*0.18);
  const fl = state.flow;
  let maxSpd = onRoad ? 55 + 10*fl : 34;   // 草地限速 20→34：平地草坪不再憋速
  if (boost) { maxSpd = onRoad ? 70 + 10*fl : 42; state.nitro = Math.max(0, state.nitro - dt*0.30); }
  else state.nitro = Math.min(1, state.nitro + dt*0.06);
  const locked = race.phase === 'countdown';

  // —— 转向输入曲线：渐进打方向，松手/反打快速回正
  const steerTarget = (padOn && Math.abs(pad.steer) > 0.01) ? -pad.steer : ((left ? 1 : 0) - (right ? 1 : 0));
  const steerRate = (steerTarget === 0 || steerTarget * state.steer < 0) ? 9 : 5;
  state.steer += THREE.MathUtils.clamp(steerTarget - state.steer, -steerRate*dt, steerRate*dt);

  // —— 车身坐标系分解（前向/侧向）
  const fx = Math.sin(state.heading), fz = Math.cos(state.heading);
  const lx2 = fz, lz2 = -fx; // 左向单位向量
  let vF = state.vx*fx + state.vz*fz;
  let vL = state.vx*lx2 + state.vz*lz2;

  // —— EV 扭矩曲线（起步猛、高速渐缓）+ 刹车/倒车 + 风阻平方
  let aF = 0;
  if (fwd && !locked) {
    // 三段式：0-60 推背（punch），60-160 主区间渐缓，160+ 贴近极速每公里都难啃
    const punch = Math.abs(vF) < 8 ? 1.22 : 1;
    aF = (boost ? 15 : 8.5) * thrAmt * punch * (1 + 0.2*fl) * Math.max(0, 1 - Math.pow(Math.max(vF, 0)/maxSpd, 2.1));
  }
  if (back) {
    if (vF > 1) aF = -26;
    else if (!locked) aF = -8.5;
  }
  aF -= 0.0005 * vF * Math.abs(vF) + (onRoad ? 0.04 : 0.30) * vF; // 风阻平方 + 滚阻（草地 0.85→0.30，减速阻尼不再过强）
  vF = THREE.MathUtils.clamp(vF + aF*dt, -9, maxSpd);
  if (!fwd && !back && Math.abs(vF) < 0.5) vF = 0;

  // —— 侧向抓地：侧滑速度指数衰减（漂移大幅降低抓地）
  const grip = drift ? 1.7 : (onRoad ? 6.8 : 3.2);
  vL *= Math.exp(-grip * dt);

  // —— 重组世界速度（航向旋转后下一帧自然产生侧滑）
  state.vx = fx*vF + lx2*vL;
  state.vz = fz*vF + lz2*vL;

  // —— 偏航：速度敏感转向
  const speedFactor = 1 / (1 + Math.pow(Math.abs(vF)*0.030, 1.5));
  const yaw = state.steer * 2.4 * speedFactor * (drift ? 1.5 : 1);
  state.heading += yaw * THREE.MathUtils.clamp(vF, -10, 30) * dt * 0.034;
  // 漂移自动回正辅助（轻微朝速度方向收敛，避免原地打转）
  if (drift && Math.abs(vL) > 2 && Math.abs(vF) > 2) {
    state.heading += wrapPi(Math.atan2(state.vx, state.vz) - state.heading) * Math.min(1, dt*0.9);
  }

  const prevPX = state.pos.x, prevPZ = state.pos.z;
  state.heading = wrapPi(state.heading);
  state.pos.x += state.vx * dt;
  state.pos.z += state.vz * dt;
  state.speed = vF;
  state.travel = (Math.abs(vF) > 1 || Math.abs(vL) > 1) ? Math.atan2(state.vx, state.vz) : state.heading;

  // —— 桥面护栏：实体墙。用位移后的实时位置判定（高速下帧首位置会穿墙），
  // 只要处于桥面高度就强制推回桥内，从机制上杜绝"挂壁/卡墙"
  {
    const bi3 = branchInfo(state.pos.x, state.pos.z);
    if (bi3.bridge && state.pos.y > bi3.y - 1.2 && state.pos.y < bi3.y + 3) {
      const bs = bSamples[bi3.idx], bn = bNormals[bi3.idx];
      const lim = B_HALF + 0.12 - CAR_R; // 视觉护栏内沿 - 车体半宽
      const svNew = (state.pos.x - bs.x)*bn.x + (state.pos.z - bs.z)*bn.z;
      const svPrev = (prevPX - bs.x)*bn.x + (prevPZ - bs.z)*bn.z;
      const aN = Math.abs(svNew);
      // 扫掠检测：上一帧在墙内侧、本帧越过（哪怕越很远）一律判中
      const crossed = Math.abs(svPrev) <= lim + 0.2 && aN > lim;
      if ((aN > lim && aN < B_HALF + 1.6) || crossed) {
        const sideSign = Math.sign(svNew) || Math.sign(svPrev) || 1;
        const vn2 = state.vx*bn.x*sideSign + state.vz*bn.z*sideSign;
        if (vn2 > 12) {
          // GTA 式冲破：高速猛撞直接撞飞护栏、腾空冲出桥外
          spawnBreakDebris(state.pos.x + bn.x*sideSign*1.2, bi3.y + 0.6, state.pos.z + bn.z*sideSign*1.2, state.vx, state.vz);
          sfx('smash', 1.6);
          G.shake = Math.max(G.shake, 0.8);
          skillPop('冲破护栏！', true);
          state.vx *= 0.82; state.vz *= 0.82;
        } else {
          state.pos.x = bs.x + bn.x*sideSign*lim;
          state.pos.z = bs.z + bn.z*sideSign*lim;
          if (vn2 > 0) {
            state.vx -= bn.x*sideSign*vn2*1.35;
            state.vz -= bn.z*sideSign*vn2*1.35;
            if (vn2 > 4) { G.shake = Math.max(G.shake, 0.3); sfx('thud', 0.7); }
          }
        }
      }
    }
  }

  // —— 贴地 / 腾空物理（冲坡、飞出桥面 → 抛物线 + 落地反馈）
  let gy = surfaceHeight(state.pos.x, state.pos.z, state.pos.y);
  // —— 防楔入：超过 55cm 的台阶一律视为实体墙（错位路沿/桥侧/并行路段步差）。
  // 只回退"朝墙"的位移分量、保留沿墙切向滑动（贴墙不定住）；
  // 速度强制衰减，杜绝"位置冻结但速度高企 → 原地持续喷尾气"的死锁
  if (!state.airborne && gy - state.pos.y > 0.8) {
    const cy = state.pos.y;
    const gxp = surfaceHeight(state.pos.x + 0.6, state.pos.z, cy) - surfaceHeight(state.pos.x - 0.6, state.pos.z, cy);
    const gzp = surfaceHeight(state.pos.x, state.pos.z + 0.6, cy) - surfaceHeight(state.pos.x, state.pos.z - 0.6, cy);
    const gl = Math.hypot(gxp, gzp);
    if (gl > 0.01) {
      const wx = gxp/gl, wz = gzp/gl;        // 指向高处（墙内法线）
      const mx = state.pos.x - prevPX, mz = state.pos.z - prevPZ;
      const mUp = mx*wx + mz*wz;             // 本帧位移的朝墙分量
      if (mUp > 0) { state.pos.x -= wx*mUp; state.pos.z -= wz*mUp; }
      const vUp = state.vx*wx + state.vz*wz;
      if (vUp > 0) {
        state.vx -= wx*vUp*1.25;
        state.vz -= wz*vUp*1.25;
        if (vUp > 5) { G.shake = Math.max(G.shake, Math.min(0.7, vUp*0.04)); sfx('thud', Math.min(1.5, vUp*0.08)); }
      }
    } else {
      // 梯度不可靠（墙体厚处）：完全回退并强衰减，确保不会冻位喷尾气
      state.pos.x = prevPX; state.pos.z = prevPZ;
      state.vx *= 0.55; state.vz *= 0.55;
    }
    gy = surfaceHeight(state.pos.x, state.pos.z, state.pos.y);
    if (gy - state.pos.y > 0.8) {
      // 滑动后仍在高台内（极端凹角）：保底完全回退 + 强衰减
      state.pos.x = prevPX; state.pos.z = prevPZ;
      state.vx *= 0.55; state.vz *= 0.55;
      gy = surfaceHeight(state.pos.x, state.pos.z, state.pos.y);
    }
  }
  const gap = state.pos.y - gy;
  if (state.airborne) {
    state.vyAir -= 24*dt;
    state.pos.y += state.vyAir*dt;
    if (state.pos.y <= gy) {
      if (state.vyAir < -7) {
        G.shake = Math.max(G.shake, Math.min(0.6, -state.vyAir*0.045));
        sfx('thud', Math.min(1.4, -state.vyAir*0.09));
        if (state.vyAir < -10) skillPop('落地！', true);
        state.flow = Math.min(1, state.flow + 0.1);
        if (state.vyAir < -12) unlockAch('fly');
      }
      state.pos.y = gy;
      state.vyAir = 0;
      state.airborne = false;
    }
  } else if (gap > 1.0 && state.vyAir > 2.5 && Math.abs(state.speed) > 15) {
    state.airborne = true; // 高速冲出坡顶：带上坡赋予的垂直初速起跳
  } else if (gap > 2.6) {
    state.airborne = true; // 突然悬空（冲出桥面/悬崖）
    state.vyAir = Math.min(state.vyAir, 0);
  } else {
    // 贴地：下坡快速贴附（杜绝下坡误入腾空态造成的颠簸），上坡平滑
    const prevY = state.pos.y;
    const rate = gy < state.pos.y ? 30 : 22; // 上坡贴附加快：高速上坡时车身能跟上路面，避免落差误判为墙而原地截停
    state.pos.y += (gy - state.pos.y) * Math.min(1, dt*rate);
    const instV = dt > 0 ? (state.pos.y - prevY)/dt : 0;
    state.vyAir = Math.max(-2, Math.min(14, state.vyAir*0.65 + instV*0.35)); // 平滑，滤掉起伏毛刺
  }
  const hF = surfaceHeight(state.pos.x + fx*1.5, state.pos.z + fz*1.5, state.pos.y);
  const hB = surfaceHeight(state.pos.x - fx*1.5, state.pos.z - fz*1.5, state.pos.y);
  const hR = surfaceHeight(state.pos.x + fz*0.9, state.pos.z - fx*0.9, state.pos.y);
  const hL = surfaceHeight(state.pos.x - fz*0.9, state.pos.z + fx*0.9, state.pos.y);
  // 边缘钳制：与车底落差超过 1.2m 的采样点（墙外/桥外深沟）不参与姿态计算
  const hF2 = Math.abs(hF - gy) > 1.2 ? gy : hF;
  const hB2 = Math.abs(hB - gy) > 1.2 ? gy : hB;
  const hR2 = Math.abs(hR - gy) > 1.2 ? gy : hR;
  const hL2 = Math.abs(hL - gy) > 1.2 ? gy : hL;
  const tPitch = THREE.MathUtils.clamp(Math.atan2(hB2 - hF2, 3), -0.38, 0.38);
  const tRoll = THREE.MathUtils.clamp(Math.atan2(hR2 - hL2, 1.8), -0.32, 0.32);
  state.pitch += (tPitch + (aF > 2 ? -0.012 : aF < -8 ? 0.02 : 0) - state.pitch) * Math.min(1, dt*6);
  const driftLean = THREE.MathUtils.clamp(vL*0.010, -0.14, 0.14); // 限幅：高速漂移不再侧翻
  state.roll += (THREE.MathUtils.clamp(tRoll - driftLean, -0.40, 0.40) - state.roll) * Math.min(1, dt*6);

  if (gy < -0.5) {
    const ridx = nr.idx;
    state.pos.set(samples[ridx].x, samples[ridx].y+0.05, samples[ridx].z);
    state.heading = state.travel = Math.atan2(tangents[ridx].x, tangents[ridx].z);
    state.speed = 0; state.vx = 0; state.vz = 0;
    showMsg('落水了！已重置 🌊', 1400, 36);
  }

  // —— 自动脱困：持续给油/倒车但位置几乎不动（被墙体/台阶卡住）→ 2.5 秒后自动回正
  const movedD = Math.hypot(state.pos.x - prevPX, state.pos.z - prevPZ);
  if ((fwd || back) && !state.airborne && movedD < 0.02) {
    state.stuckT = (state.stuckT || 0) + dt;
    if (state.stuckT > 2.5) {
      state.stuckT = 0;
      const nrS = nearestRoad(state.pos.x, state.pos.z);
      state.pos.set(samples[nrS.idx].x, samples[nrS.idx].y + 0.1, samples[nrS.idx].z);
      state.heading = state.travel = Math.atan2(tangents[nrS.idx].x, tangents[nrS.idx].z);
      state.speed = 0; state.vx = 0; state.vz = 0; state.vyAir = 0;
      showMsg('已自动脱困 🛟', 1400, 30);
    }
  } else state.stuckT = 0;

  // 刹车/倒车：驱动原厂贯穿式尾灯条（状态切换时保存/恢复当前昼夜基准）
  {
    const want = (back && vF > 1) ? 2 : (vF < -0.5 ? 1 : 0);
    if (want !== rearLampState && rearLampMats.length) {
      if (rearLampState === 0) {
        for (const m of rearLampMats) {
          m.userData.savedE = m.emissive.getHex();
          m.userData.savedI = m.emissiveIntensity;
        }
      }
      for (const m of rearLampMats) {
        if (want === 2) { m.emissive.setHex(0xff1414); m.emissiveIntensity = 3.4; }
        else if (want === 1) { m.emissive.setHex(0xff6a55); m.emissiveIntensity = 2.0; }
        else { m.emissive.setHex(m.userData.savedE ?? 0x000000); m.emissiveIntensity = m.userData.savedI ?? 1; }
      }
      rearLampState = want;
    }
  }
  // 接触阴影：贴地跟随，腾空渐隐
  carShadow.position.set(state.pos.x, gy + 0.04, state.pos.z);
  carShadow.rotation.y = state.heading;
  carShadow.material.opacity = 0.4 * Math.max(0.12, Math.min(1, 1 - (state.pos.y - gy)/4));

  car.position.copy(state.pos);
  car.rotation.set(state.pitch, state.heading, state.roll, 'YXZ');

  if (G.carReady) {
    const wr = state.speed * dt / wheelRadius;
    for (const sp of spinPivots) sp.rotation.x += wr;
    for (const st of steerPivots) st.rotation.y = state.steer * 0.45;
  }
  if (!onRoad && !state.airborne && Math.abs(state.speed) > 6) {
    car.position.y += Math.sin(performance.now()*0.012)*0.012; // 草地：轻缓起伏而非石子路颠簸
  }
  return {onRoad, boost};
}

// ---------- 驾驶相机 ----------
const camPos = new THREE.Vector3(samples[garageIdx].x - 8, samples[garageIdx].y + 4, samples[garageIdx].z - 8);
const camDamp = { x:{v:0}, y:{v:0}, z:{v:0} };
// 临界阻尼弹簧（SmoothDamp），无过冲、无橡皮筋感
function sdamp(cur, tgt, s, st, dt) {
  const omega = 2/st, x = omega*dt;
  const e = 1/(1 + x + 0.48*x*x + 0.235*x*x*x);
  const ch = cur - tgt;
  const tmp = (s.v + omega*ch)*dt;
  s.v = (s.v - omega*tmp)*e;
  return tgt + (ch + tmp)*e;
}
// 相机独立偏航角：重阻尼跟随，车先转、镜头慢半拍（赛车游戏标准做法）
const camAng = { yaw: 0, init: false };
const wrapAngle = wrapPi;
function updateChaseCamera(dt, boost) {
  const spd = Math.abs(state.speed);
  const fx = Math.sin(state.heading), fz = Math.cos(state.heading);
  // 目标偏航：默认车头方向；明显漂移（带死区）时向速度方向偏一部分
  let tYaw = state.heading;
  if (state.speed > 4) {
    const dT = wrapAngle(state.travel - state.heading);
    const dead = 0.07; // 死区：小侧滑不动镜头
    if (Math.abs(dT) > dead) {
      tYaw = state.heading + (dT - Math.sign(dT)*dead) * 0.55 * Math.min(1, (state.speed - 4)/8);
    }
  }
  if (!camAng.init) { camAng.yaw = tYaw; camAng.init = true; }
  // 偏航重阻尼：方向键抖动不再传导到镜头
  camAng.yaw = wrapPi(camAng.yaw + wrapAngle(tYaw - camAng.yaw) * Math.min(1, dt*3.0));
  // 倒车镜头：倒车时机位转到车头方向回看
  const camYawUse = state.speed < -2 ? camAng.yaw + Math.PI : camAng.yaw;
  const dx = Math.sin(camYawUse), dz = Math.cos(camYawUse);
  if (G.camMode <= 2) {
    const back = G.camMode === 0 ? 9.5 : G.camMode === 1 ? 6.0 : 4.4;
    const up   = G.camMode === 0 ? 3.3 : G.camMode === 1 ? 2.0 : 1.5;
    camPos.x = sdamp(camPos.x, state.pos.x - dx*back, camDamp.x, 0.13, dt);
    camPos.z = sdamp(camPos.z, state.pos.z - dz*back, camDamp.z, 0.13, dt);
    camPos.y = sdamp(camPos.y, state.pos.y + up,      camDamp.y, 0.28, dt);
    // 硬性距离上限
    const ax = state.pos.x, ay = state.pos.y + 2.5, az = state.pos.z;
    const L = Math.sqrt(back*back + (up-2.5)*(up-2.5)) + 1.4;
    const ddx = camPos.x-ax, ddy = camPos.y-ay, ddz = camPos.z-az;
    const d = Math.sqrt(ddx*ddx + ddy*ddy + ddz*ddz);
    if (d > L) {
      const s = L/d;
      camPos.set(ax + ddx*s, ay + ddy*s, az + ddz*s);
    }
  } else if (G.camMode === 3) {
    camPos.set(state.pos.x + fx*0.25 + fz*0.36, state.pos.y + 1.06, state.pos.z + fz*0.25 - fx*0.36); // 左舵驾驶位
  } else {
    const a = performance.now()*0.0002;
    camPos.lerp(new THREE.Vector3(state.pos.x + Math.sin(a)*14, state.pos.y + 5.5, state.pos.z + Math.cos(a)*14), Math.min(1, dt*4.5));
  }
  // 防止追逐镜头钻入地形
  if (G.camMode !== 3) {
    const gyC = groundHeight(camPos.x, camPos.z);
    if (camPos.y < gyC + 0.55) camPos.y = gyC + 0.55;
  }
  camera.position.copy(camPos);
  // 撞击镜头震动
  if (G.shake > 0.004) {
    camera.position.x += (Math.random()-0.5)*G.shake;
    camera.position.y += (Math.random()-0.5)*G.shake*0.6;
    camera.position.z += (Math.random()-0.5)*G.shake;
    G.shake *= Math.exp(-dt*5.5);
  }
  if (G.appState === 'drive' && spd > 42) {
    G.shake = Math.max(G.shake, Math.min(0.10, (spd - 42)*0.004)); // 高速路感微震
  }
  // 视线沿镜头偏航角看向车前方（与机位同源，杜绝左右甩动）
  const ahead = 5.5 + spd*0.08;
  const lookYaw = G.camMode === 3 ? state.heading : camYawUse;
  camera.lookAt(
    state.pos.x + Math.sin(lookYaw)*ahead,
    state.pos.y + 1.1,
    state.pos.z + Math.cos(lookYaw)*ahead
  );
  const targetFov = 66 + Math.min(14, spd*0.21) + (boost ? 6 : 0); // 速度感：FOV 随速外扩
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt*3);
  // 近裁面随视角切换：座舱视角相机贴在仪表台前，需要 0.1 避免切掉车内几何；
  // 外部视角用 0.3 给 GTAO 留深度精度（updateProjectionMatrix 本就每帧调用，无额外开销）
  const wantNear = G.camMode === 3 ? 0.1 : 0.3;
  if (camera.near !== wantNear) camera.near = wantNear;
  camera.updateProjectionMatrix();
}


export function addFlow(d) {
  state.flow = Math.max(0, Math.min(1, state.flow + d));
}

// —— 刹车/倒车灯：直接驱动模型自带的贯穿式尾灯材质（无传统倒车白灯）
const rearLampMats = [];
let rearLampState = 0; // 0 常态 / 1 倒车提亮 / 2 刹车深红
// —— 车底假接触阴影（柔和椭圆，落地感）
const carShadow = (() => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const x = cv.getContext('2d');
  const gr = x.createRadialGradient(64, 64, 8, 64, 64, 62);
  gr.addColorStop(0, 'rgba(0,0,0,0.85)');
  gr.addColorStop(0.65, 'rgba(0,0,0,0.4)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = gr;
  x.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(cv);
  const g2 = new THREE.PlaneGeometry(3.4, 5.8);
  g2.rotateX(-Math.PI/2);
  const m2 = new THREE.Mesh(g2, new THREE.MeshBasicMaterial({map: tex, transparent: true, opacity: 0.4, depthWrite: false}));
  m2.renderOrder = 1;
  scene.add(m2);
  return m2;
})();

// 幽灵车：半透明克隆（PB 回放用；后续接入多车型时同一管线可复用）
export function createGhostClone() {
  if (!G.carReady) return null;
  const gm = new THREE.MeshBasicMaterial({color: 0x5fd8ff, transparent: true, opacity: 0.3, depthWrite: false});
  const ghost = car.clone(true);
  ghost.traverse(o => {
    if (o.isMesh) { o.material = gm; o.castShadow = false; o.receiveShadow = false; }
    if (o.isLight || o.isSprite) o.visible = false;
  });
  ghost.visible = false;
  scene.add(ghost);
  return ghost;
}

// 无人驾驶滑行：下车后车按强阻力自然滚停（既不瞬间定死、也不无限飞出），步行模式每帧调用
export function coastVehicle(dt) {
  const sp = Math.hypot(state.vx, state.vz);
  if (sp < 0.15 && Math.abs(state.speed) < 0.15) { state.vx = 0; state.vz = 0; state.speed = 0; return; }
  const k = Math.exp(-3.0 * dt);
  state.vx *= k; state.vz *= k; state.speed *= k;
  state.pos.x += state.vx * dt;
  state.pos.z += state.vz * dt;
  settleCarPose();
}

export { car, state, PAINTS, applySkin, setGlassSeeThru, settleCarPose, physics, updateChaseCamera, camPos, camDamp, camAng };
