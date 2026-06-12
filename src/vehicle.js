import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { G, scene, camera, wrapPi } from './core.js';
import { samples, tangents, normals, garageIdx, nearestRoad, surfaceHeight, groundHeight, branchInfo, bSamples, bNormals, B_HALF, HALF_W, applyTod } from './world.js';
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
  const sp = new THREE.SpotLight(0xcfe0ff, 0, 85, 0.36, 0.65, 1.8);
  sp.position.set(sx*0.70, 0.66, 2.72);
  const tgt = new THREE.Object3D();
  tgt.position.set(sx*0.85, -0.75, 22);
  car.add(sp); car.add(tgt);
  sp.target = tgt;
  G.headlights.push(sp);
}

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
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
          if ('clearcoat' in m) { m.clearcoat = 1.0; m.clearcoatRoughness = 0.07; }
          m.userData.origColor = m.color.clone();
        }
        if (m.name === 'Mat_E29_Lamps') {
          G.lampMats.push(m);
          m.userData.origEmissive = (m.emissive ? m.emissive.clone() : new THREE.Color(0));
          m.userData.origEI = m.emissiveIntensity !== undefined ? m.emissiveIntensity : 1;
        }
        if (m.name === 'Mat_E29_Glass') {
          // 默认保持原厂深色玻璃；仅座舱视角动态切换为半透明（见 setGlassSeeThru）
          m.envMapIntensity = 2.0;
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
  travel: 0, speed: 0, vx: 0, vz: 0, vyAir: 0, airborne: false, steer: 0, nitro: 1, roll: 0, pitch: 0
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

function physics(dt) {
  const fwd = keys['KeyW'] || keys['ArrowUp'];
  const back = keys['KeyS'] || keys['ArrowDown'];
  const left = keys['KeyA'] || keys['ArrowLeft'];
  const right = keys['KeyD'] || keys['ArrowRight'];
  const drift = keys['Space'];
  const boost = (keys['ShiftLeft'] || keys['ShiftRight']) && state.nitro > 0.02 && state.speed > 2;

  const nr = nearestRoad(state.pos.x, state.pos.z);
  const bi2 = branchInfo(state.pos.x, state.pos.z);
  const onRoad = nr.dist < HALF_W + 1.2 || bi2.dist < B_HALF + 1.0;
  let maxSpd = onRoad ? 150 : 45;
  if (boost) { maxSpd = onRoad ? 200 : 55; state.nitro = Math.max(0, state.nitro - dt*0.30); }
  else state.nitro = Math.min(1, state.nitro + dt*0.06);
  const locked = race.phase === 'countdown';

  // —— 转向输入曲线：渐进打方向，松手/反打快速回正
  const steerTarget = (left ? 1 : 0) - (right ? 1 : 0);
  const steerRate = (steerTarget === 0 || steerTarget * state.steer < 0) ? 9 : 5;
  state.steer += THREE.MathUtils.clamp(steerTarget - state.steer, -steerRate*dt, steerRate*dt);

  // —— 车身坐标系分解（前向/侧向）
  const fx = Math.sin(state.heading), fz = Math.cos(state.heading);
  const lx2 = fz, lz2 = -fx; // 左向单位向量
  let vF = state.vx*fx + state.vz*fz;
  let vL = state.vx*lx2 + state.vz*lz2;

  // —— EV 扭矩曲线（起步猛、高速渐缓）+ 刹车/倒车 + 风阻平方
  let aF = 0;
  if (fwd && !locked) aF = (boost ? 100 : 70) * Math.max(0.22, 1 - Math.pow(Math.max(vF, 0)/maxSpd, 2));
  if (back) {
    if (vF > 1) aF = -50;
    else if (!locked) aF = -12;
  }
  aF -= 0.004 * vF * Math.abs(vF) + (onRoad ? 0.15 : 0.85) * vF;
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
  if (!state.airborne && gy - state.pos.y > 0.55) {
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
    if (gy - state.pos.y > 0.55) {
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
    const rate = gy < state.pos.y ? 30 : 12;
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
  state.roll += (tRoll - vL*0.012 - state.roll) * Math.min(1, dt*6);

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
  const dx = Math.sin(camAng.yaw), dz = Math.cos(camAng.yaw);
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
  // 视线沿镜头偏航角看向车前方（与机位同源，杜绝左右甩动）
  const ahead = 5.5 + spd*0.08;
  const lookYaw = G.camMode === 3 ? state.heading : camAng.yaw;
  camera.lookAt(
    state.pos.x + Math.sin(lookYaw)*ahead,
    state.pos.y + 1.1,
    state.pos.z + Math.cos(lookYaw)*ahead
  );
  const targetFov = 70 + (boost ? 12 : Math.min(spd*0.12, 6));
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt*5);
  camera.updateProjectionMatrix();
}


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

export { car, state, PAINTS, applySkin, setGlassSeeThru, settleCarPose, physics, updateChaseCamera, camPos, camDamp, camAng };
