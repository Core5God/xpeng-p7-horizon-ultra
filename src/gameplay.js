import * as THREE from 'three';
import { G, scene, wrapPi } from './core.js';
import { samples, tangents, normals, NS, HALF_W, groundHeight, meshGroundHeight, surfaceHeight, nearestRoad, branchInfo, islandBase, env, BRANCH_A, BRANCH_B, bSamples, bNormals } from './world.js';
import { state, createGhostClone, addFlow } from './vehicle.js';
import { actx, makeNoiseBurst } from './audio.js';
import { showMsg, keys, refreshRecords } from './ui.js';

// ---------- 玩法系统：海滩建筑 / 可破坏道具 / 碎片物理 / 计分连击 ----------
const props = [];          // 可破坏道具与沙滩球
const debris = [];         // 飞散碎片
const buildingCols = [];   // 建筑碰撞体
const railSegs = [];       // 可破坏悬崖护栏（线段碰撞）
const zones = [];          // 路线任务点（光圈停车开赛）
let zoneGrp = null;
let score = 0, scoreBest = 0, combo = 1, comboEvents = 0, lastScoreT = 0;
let cruiseT = 0, driftAcc = 0;
try { const b = localStorage.getItem('p7_scoreBest'); if (b) scoreBest = parseInt(b) || 0; } catch(e) {}
function saveBestScore() {
  if (score > scoreBest) {
    scoreBest = score;
    try { localStorage.setItem('p7_scoreBest', String(scoreBest)); } catch(e) {}
  }
}
const SMASH_LABEL = { parasol:'遮阳伞 粉碎', chair:'躺椅 粉碎', crate:'木箱 粉碎', fence:'栅栏 粉碎', sign:'路牌 粉碎', cone:'路锥 粉碎' };
let popLastText = '', popLastT = 0;
function skillPop(text, big) {
  // 去重限流：相同文案 500ms 内只弹一次（持续碰撞时避免 DOM 风暴）
  const nowP = performance.now();
  if (text === popLastText && nowP - popLastT < 500) return;
  popLastText = text; popLastT = nowP;
  const stack = document.getElementById('skillstack');
  const d = document.createElement('div');
  d.className = 'skill' + (big ? ' big' : '');
  d.textContent = text;
  stack.appendChild(d);
  while (stack.children.length > 5) stack.removeChild(stack.firstChild);
  setTimeout(() => d.remove(), 1650);
}
function updateScoreChip() {
  document.getElementById('scoreval').textContent = score.toLocaleString();
  const cb = document.getElementById('combox');
  cb.textContent = '×' + combo;
  cb.style.color = ['', '#cfd8e4', '#7fe9ff', '#7dff9a', '#ffd54f', '#ff8a65'][combo] || '#fff';
}
function addScore(base, label, big) {
  const pts = Math.round(base * combo);
  score += pts;
  comboEvents++;
  lastScoreT = performance.now();
  if (comboEvents >= 4 && combo < 5) {
    combo++; comboEvents = 0;
    skillPop('连击提升 ×' + combo, true);
    if (combo === 5) unlockAch('combo5');
  }
  if (score >= 15000) unlockAch('score15k');
  skillPop('+' + pts + '  ' + label, big);
  updateScoreChip();
}
// 撞击/踢球音效
const sfxLast = {};
function sfx(type, inten) {
  if (!actx || G.muted) return;
  // 限流：同类音效 90ms 内只发一次（持续蹭墙时避免每帧创建音频节点导致卡死）
  const nowS = performance.now();
  if (nowS - (sfxLast[type] || 0) < 90) return;
  sfxLast[type] = nowS;
  const i2 = isFinite(inten) && inten > 0 ? inten : 1; // 守卫：NaN 强度会让 AudioParam 抛异常
  const t0 = actx.currentTime;
  if (type === 'smash' || type === 'thud') {
    const nb = actx.createBufferSource(); nb.buffer = makeNoiseBurst();
    const f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = type === 'smash' ? 1200 : 420;
    const g = actx.createGain();
    g.gain.setValueAtTime(Math.min(0.4, 0.18*i2), t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + (type === 'smash' ? 0.22 : 0.32));
    nb.connect(f); f.connect(g); g.connect(actx.destination); nb.start(t0);
    const o = actx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(type === 'smash' ? 110 : 62, t0);
    o.frequency.exponentialRampToValueAtTime(38, t0 + 0.18);
    const g2 = actx.createGain();
    g2.gain.setValueAtTime(Math.min(0.5, 0.25*i2), t0);
    g2.gain.exponentialRampToValueAtTime(0.001, t0 + 0.26);
    o.connect(g2); g2.connect(actx.destination); o.start(t0); o.stop(t0 + 0.3);
  } else if (type === 'boing') {
    const o = actx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(200, t0);
    o.frequency.exponentialRampToValueAtTime(430, t0 + 0.12);
    const g = actx.createGain();
    g.gain.setValueAtTime(0.18, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);
    o.connect(g); g.connect(actx.destination); o.start(t0); o.stop(t0 + 0.22);
  }
}
function smashRail(rs, spd) {
  rs.intact = false;
  for (const m of rs.pieces) {
    scene.attach(m);
    debris.push({ m,
      vx: state.vx*0.7 + (Math.random()-0.5)*4,
      vy: 3 + Math.random()*3 + spd*0.15,
      vz: state.vz*0.7 + (Math.random()-0.5)*4,
      rx: (Math.random()-0.5)*10, ry: (Math.random()-0.5)*10, rz: (Math.random()-0.5)*10,
      life: 2.6 + Math.random() });
  }
  while (debris.length > 90) { scene.remove(debris[0].m); debris.shift(); }
  scene.remove(rs.group);
  addScore(40, '护栏 冲破');
  G.shake = Math.max(G.shake, Math.min(0.7, spd*0.02));
  sfx('smash', Math.min(1.8, 0.6 + spd*0.03));
  state.vx *= 0.93; state.vz *= 0.93;
}
function spawnBreakDebris(x, y, z, vx, vz) {
  const m0 = new THREE.MeshStandardMaterial({color:0xd8d8de, roughness:0.5, metalness:0.5});
  for (let k = 0; k < 4; k++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.5, 1.0 + Math.random()), m0);
    m.position.set(x, y, z);
    scene.add(m);
    debris.push({ m,
      vx: vx*0.6 + (Math.random()-0.5)*5, vy: 3.5 + Math.random()*3, vz: vz*0.6 + (Math.random()-0.5)*5,
      rx: (Math.random()-0.5)*10, ry: (Math.random()-0.5)*10, rz: (Math.random()-0.5)*10, life: 2.4 });
  }
  while (debris.length > 90) { scene.remove(debris[0].m); debris.shift(); }
}
function smashProp(p, spd) {
  p.intact = false;
  for (const m of p.pieces) {
    scene.attach(m);
    debris.push({
      m,
      vx: state.vx*0.55 + (Math.random()-0.5)*5,
      vy: 2.5 + Math.random()*3 + spd*0.12,
      vz: state.vz*0.55 + (Math.random()-0.5)*5,
      rx: (Math.random()-0.5)*9, ry: (Math.random()-0.5)*9, rz: (Math.random()-0.5)*9,
      life: 2.4 + Math.random()
    });
  }
  while (debris.length > 90) { scene.remove(debris[0].m); debris.shift(); }
  scene.remove(p.group);
  addScore(p.type === 'cone' ? 25 : 50, SMASH_LABEL[p.type] || '粉碎');
  stats.smashes++;
  if (stats.smashes >= 50) unlockAch('smash50');
  saveRecords();
  state.nitro = Math.min(1, state.nitro + 0.08); // 拆迁奖励：氮气返还
  G.shake = Math.max(G.shake, Math.min(0.6, spd*0.018));
  sfx('smash', Math.min(1.6, 0.5 + spd*0.03));
  state.vx *= 0.965; state.vz *= 0.965;
}
function gameplayUpdate(dt, onRoad) {
  const now = performance.now();
  const px = state.pos.x, pz = state.pos.z;
  const spd = Math.hypot(state.vx, state.vz);
  // —— 道具碰撞 / 擦身奖励（沙滩球已移除）
  for (const p of props) {
    if (p.type === 'ball') continue; // 兼容旧数据
    if (!p.intact) continue;
    const dx = px - p.x, dz = pz - p.z;
    const d2 = dx*dx + dz*dz;
    if (d2 > 1600) continue;
    const hitR = p.r + 1.05;
    if (d2 < hitR*hitR && spd > 2.5) smashProp(p, spd);
    else if (!p.nearMiss && spd > 16 && d2 < 11.5) {
      p.nearMiss = true;
      addScore(30, '擦身而过');
      addFlow(0.08);
    }
  }
  // —— 建筑碰撞：推出 + 反弹 + 连击清零
  for (const b of buildingCols) {
    const dx = px - b.x, dz = pz - b.z;
    const d = Math.hypot(dx, dz);
    const rr = b.r + 1.0;
    if (d < rr && d > 0.001) {
      const nx = dx/d, nz = dz/d;
      state.pos.x = b.x + nx*rr;
      state.pos.z = b.z + nz*rr;
      const vn = state.vx*nx + state.vz*nz;
      if (vn < 0) {
        state.vx -= nx*vn*(b.soft ? 1.8 : 1.7);
        state.vz -= nz*vn*(b.soft ? 1.8 : 1.7);
        const imp = -vn;
        if (imp > 5) {
          G.shake = Math.max(G.shake, Math.min(0.9, imp*0.035));
          sfx('thud', Math.min(2, imp*(b.soft ? 0.06 : 0.1)));
          if (b.soft) {
            skillPop('轮胎墙弹回！');
          } else {
            if (combo > 1) skillPop('撞击！连击中断', true);
            combo = 1; comboEvents = 0; cruiseT = 0;
            addFlow(-0.5);
            updateScoreChip();
          }
        }
      }
    }
  }
  // —— 碎片物理
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i];
    d.vy -= 22*dt;
    d.m.position.x += d.vx*dt; d.m.position.y += d.vy*dt; d.m.position.z += d.vz*dt;
    d.m.rotation.x += d.rx*dt; d.m.rotation.y += d.ry*dt; d.m.rotation.z += d.rz*dt;
    const gy = meshGroundHeight(d.m.position.x, d.m.position.z) + 0.06;
    if (d.m.position.y < gy) {
      d.m.position.y = gy;
      d.vy *= -0.32;
      d.vx *= 0.6; d.vz *= 0.6;
      d.rx *= 0.5; d.rz *= 0.5;
    }
    d.life -= dt;
    if (d.life < 0.4) d.m.scale.multiplyScalar(Math.max(0.01, 1 - dt*2.5));
    if (d.life <= 0) { scene.remove(d.m); debris.splice(i, 1); }
  }
  // —— 巡航奖励（在路上保持速度）
  if (onRoad && state.speed > 12) {
    cruiseT += dt;
    if (cruiseT >= 10) { cruiseT = 0; addScore(150, '完美巡航', true); }
  } else cruiseT = 0;
  // —— 漂移结算
  const fx2 = Math.sin(state.heading), fz2 = Math.cos(state.heading);
  const vLat = state.vx*fz2 - state.vz*fx2;
  const elDrift = document.getElementById('driftlive');
  if (keys['Space'] && onRoad && Math.abs(vLat) > 3.5 && spd > 8) {
    driftAcc = Math.min(2000, driftAcc + Math.abs(vLat)*dt*9);
    if (elDrift) {
      elDrift.style.opacity = 1;
      elDrift.textContent = '漂移 +' + Math.round(driftAcc);
    }
  }
  else if (driftAcc > 0 && !keys['Space']) {
    if (elDrift) elDrift.style.opacity = 0;
    if (driftAcc > 40) { addScore(Math.round(driftAcc/10)*10, '漂移'); addFlow(Math.min(0.15, driftAcc/1500)); }
    if (driftAcc >= 400) unlockAch('drift');
    driftAcc = 0;
  }
  if (!onRoad) {
    if (driftAcc > 0 && elDrift) elDrift.style.opacity = 0;
    driftAcc = 0;
  }
  // —— 悬崖护栏线段碰撞：冲破撞飞
  for (const rs of railSegs) {
    if (!rs.intact) continue;
    const abx = rs.bx - rs.ax, abz = rs.bz - rs.az;
    const L2 = abx*abx + abz*abz;
    if (L2 < 1e-6) continue;
    let tt = ((px - rs.ax)*abx + (pz - rs.az)*abz) / L2;
    tt = Math.max(0, Math.min(1, tt));
    const ddx = px - (rs.ax + abx*tt), ddz = pz - (rs.az + abz*tt);
    if (ddx*ddx + ddz*ddz < 1.69 && spd > 4) smashRail(rs, spd);
  }
  // —— 任务点：光圈内停稳 3 秒自动开赛
  if (zoneGrp) {
    const show = race.phase === 'free' && G.appState === 'drive';
    zoneGrp.visible = show;
    if (show) {
      const tz = performance.now()*0.001;
      for (const z of zones) {
        const dxz = px - z.x, dzz = pz - z.z;
        if (dxz*dxz + dzz*dzz < 27 && spd < 2.5) {
          z.hold += dt;
          z.ring.scale.setScalar(1 + Math.sin(tz*8)*0.06);
          showMsg('启动 ' + ROUTES[z.i].name + ' · ' + Math.max(0, 3 - z.hold).toFixed(1) + 's', 260, 32);
          if (z.hold >= 3) {
            z.hold = 0;
            selectRoute(z.i);
            startRace();
            break;
          }
        } else {
          z.hold = 0;
          z.ring.scale.setScalar(1);
        }
      }
    }
  }
  // —— 连击衰减
  if (combo > 1 && now - lastScoreT > 18000) {
    combo = 1; comboEvents = 0;
    updateScoreChip();
  }
}
function buildProps() {
  // —— 共享材质 / 几何
  const woodM = new THREE.MeshStandardMaterial({color:0x9a7748, roughness:0.85});
  const whiteM = new THREE.MeshStandardMaterial({color:0xe9e3d5, roughness:0.8});
  const redM = new THREE.MeshStandardMaterial({color:0xd95a4e, roughness:0.7});
  const tealM = new THREE.MeshStandardMaterial({color:0x3aa6a0, roughness:0.7});
  const metalM = new THREE.MeshStandardMaterial({color:0xb8b2a6, roughness:0.5, metalness:0.4});
  const blueM = new THREE.MeshStandardMaterial({color:0x2b6fb5, roughness:0.6});
  const darkM = new THREE.MeshStandardMaterial({color:0x4a3d31, roughness:0.9});
  const ballMs = []; // 沙滩球已移除
  const pastel = [0xf0dfc0, 0xcfe3da, 0xf3cfc0, 0xdcd4ec];
  const umbPoleG = new THREE.CylinderGeometry(0.035, 0.05, 2.25, 6); umbPoleG.translate(0, 1.12, 0);
  const umbLeafG = new THREE.BoxGeometry(0.95, 0.05, 0.62);
  umbLeafG.translate(0.5, 0, 0); umbLeafG.rotateZ(-0.42); umbLeafG.translate(0, 2.05, 0);
  const chBaseG = new THREE.BoxGeometry(0.6, 0.07, 1.45); chBaseG.translate(0, 0.32, 0);
  const chBackG = new THREE.BoxGeometry(0.6, 0.07, 0.72); chBackG.rotateX(0.95); chBackG.translate(0, 0.56, -0.75);
  const chLegG = new THREE.BoxGeometry(0.07, 0.3, 1.1); chLegG.translate(0, 0.15, 0);
  const plankG = new THREE.BoxGeometry(0.72, 0.72, 0.07);
  const fPostG = new THREE.BoxGeometry(0.09, 0.95, 0.09); fPostG.translate(0, 0.48, 0);
  const fRailG = new THREE.BoxGeometry(1.75, 0.1, 0.05);
  const sgPoleG = new THREE.CylinderGeometry(0.04, 0.04, 1.65, 6); sgPoleG.translate(0, 0.82, 0);
  const sgPanelG = new THREE.BoxGeometry(0.8, 0.55, 0.05); sgPanelG.translate(0, 1.55, 0);
  // 沙滩球几何已移除
  function reg(group, x, z, rotY, r, type) {
    // 贴"可行驶表面"：近路取路面高度（路锥不沉入路面），路外取渲染网格（道具不悬浮）
    group.position.set(x, surfaceHeight(x, z), z);
    group.rotation.y = rotY;
    scene.add(group);
    props.push({x, z, r, type, group, pieces: group.children.slice(), intact: true, nearMiss: false});
  }
  function mkParasol(x, z) {
    const g = new THREE.Group();
    const accent = Math.random() < 0.5 ? redM : tealM;
    g.add(new THREE.Mesh(umbPoleG, metalM));
    for (let k = 0; k < 6; k++) {
      const m = new THREE.Mesh(umbLeafG, k % 2 ? whiteM : accent);
      m.rotation.y = k/6*Math.PI*2;
      g.add(m);
    }
    reg(g, x, z, Math.random()*6.3, 0.85, 'parasol');
  }
  function mkChair(x, z, rot) {
    const g = new THREE.Group();
    const cm = Math.random() < 0.5 ? tealM : whiteM;
    g.add(new THREE.Mesh(chBaseG, cm));
    g.add(new THREE.Mesh(chBackG, cm));
    const l1 = new THREE.Mesh(chLegG, woodM); l1.position.x = -0.26; g.add(l1);
    const l2 = new THREE.Mesh(chLegG, woodM); l2.position.x = 0.26; g.add(l2);
    reg(g, x, z, rot, 0.8, 'chair');
  }
  function mkCrate(x, z) {
    const g = new THREE.Group();
    for (const [ox, oy, oz, top, ry] of [[0,0.36,0.33,0,0],[0,0.36,-0.33,0,0],[0.33,0.36,0,0,1],[-0.33,0.36,0,0,1],[0,0.72,0,1,0]]) {
      const m = new THREE.Mesh(plankG, woodM);
      m.position.set(ox, oy, oz);
      if (top) m.rotation.x = Math.PI/2;
      else if (ry) m.rotation.y = Math.PI/2;
      g.add(m);
    }
    reg(g, x, z, Math.random()*6.3, 0.6, 'crate');
  }
  function mkFence(x, z, rot) {
    const g = new THREE.Group();
    const p1 = new THREE.Mesh(fPostG, whiteM); p1.position.x = -0.85; g.add(p1);
    const p2 = new THREE.Mesh(fPostG, whiteM); p2.position.x = 0.85; g.add(p2);
    const r1 = new THREE.Mesh(fRailG, whiteM); r1.position.y = 0.78; g.add(r1);
    const r2 = new THREE.Mesh(fRailG, whiteM); r2.position.y = 0.42; g.add(r2);
    reg(g, x, z, rot, 1.0, 'fence');
  }
  function mkSign(x, z, rot) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(sgPoleG, metalM));
    g.add(new THREE.Mesh(sgPanelG, blueM));
    reg(g, x, z, rot, 0.5, 'sign');
  }
  // mkBall 已移除（路边弹跳球体）
  function beachSpot(minRoad, hMin, hMax) {
    for (let t = 0; t < 300; t++) {
      const a = Math.random()*Math.PI*2, r = 60 + Math.random()*540;
      const x = Math.cos(a)*r, z = Math.sin(a)*r;
      if (nearestRoad(x, z).dist < minRoad || branchInfo(x, z).dist < minRoad) continue;
      const h = groundHeight(x, z);
      if (h < hMin || h > hMax) continue;
      const slope = Math.abs(groundHeight(x+5, z) - groundHeight(x-5, z))
                  + Math.abs(groundHeight(x, z+5) - groundHeight(x, z-5));
      if (slope > 2.2) continue;
      return {x, z, h};
    }
    return null;
  }
  // —— 建筑（不可破坏，有碰撞）
  function addBuilding(g, x, z, rotY, r) {
    g.position.set(x, surfaceHeight(x, z), z);
    g.rotation.y = rotY;
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
    buildingCols.push({x, z, r});
  }
  function mkHut(wallHex) {
    const g = new THREE.Group();
    const wall = new THREE.MeshStandardMaterial({color:wallHex, roughness:0.85});
    const body = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.2, 2.8), wall); body.position.y = 1.1; g.add(body);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.7, 1.4, 4), darkM); roof.position.y = 2.9; roof.rotation.y = Math.PI/4; g.add(roof);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.75, 1.4, 0.08), darkM); door.position.set(0.4, 0.7, 1.42); g.add(door);
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 0.08), new THREE.MeshStandardMaterial({color:0x223240, roughness:0.3})); win.position.set(-0.9, 1.3, 1.42); g.add(win);
    return g;
  }
  function mkTower() {
    const g = new THREE.Group();
    const legG = new THREE.CylinderGeometry(0.09, 0.11, 2.6, 6);
    for (const [lx2, lz2] of [[-0.9,-0.9],[0.9,-0.9],[-0.9,0.9],[0.9,0.9]]) {
      const l = new THREE.Mesh(legG, woodM); l.position.set(lx2, 1.3, lz2); g.add(l);
    }
    const plat = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.15, 2.4), woodM); plat.position.y = 2.6; g.add(plat);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.4, 1.8), redM); cab.position.y = 3.4; g.add(cab);
    const rf = new THREE.Mesh(new THREE.ConeGeometry(1.8, 0.9, 4), whiteM); rf.position.y = 4.6; rf.rotation.y = Math.PI/4; g.add(rf);
    return g;
  }
  function mkKiosk() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.0, 2.0), whiteM); body.position.y = 1.0; g.add(body);
    for (let k = 0; k < 4; k++) {
      const aw = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.05, 1.25), k % 2 ? redM : whiteM);
      aw.position.set(-1.02 + k*0.68, 2.18, 1.45);
      aw.rotation.x = 0.28;
      g.add(aw);
    }
    const counter = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 0.4), woodM); counter.position.set(0, 1.0, 1.15); g.add(counter);
    return g;
  }
  function mkPier() {
    const ang = Math.random()*Math.PI*2;
    let r0 = 460;
    while (r0 < 700 && islandBase(Math.cos(ang)*r0, Math.sin(ang)*r0) > 0.5) r0 += 4;
    const dx2 = Math.cos(ang), dz2 = Math.sin(ang);
    const g = new THREE.Group();
    for (let k = 0; k < 9; k++) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.14, 1.9), woodM);
      plank.position.set(dx2*k*1.95, 1.15, dz2*k*1.95);
      plank.rotation.y = -ang;
      g.add(plank);
      if (k % 2 === 0) for (const s of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 2.6, 6), woodM);
        post.position.set(dx2*k*1.95 - dz2*s*1.1, 0, dz2*k*1.95 + dx2*s*1.1);
        g.add(post);
      }
    }
    g.position.set(dx2*(r0-6), 0, dz2*(r0-6));
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
  }
  // —— 布置
  const hutSpots = [];
  for (let i = 0; i < 5; i++) {
    const s = beachSpot(20, 0.9, 2.8);
    if (!s) continue;
    hutSpots.push(s);
    addBuilding(mkHut(pastel[i % pastel.length]), s.x, s.z, Math.random()*6.3, 2.7);
  }
  for (let i = 0; i < 2; i++) {
    const s = beachSpot(18, 0.9, 2.5);
    if (s) addBuilding(mkTower(), s.x, s.z, Math.random()*6.3, 1.8);
  }
  const ks = beachSpot(16, 1.0, 3.0);
  if (ks) addBuilding(mkKiosk(), ks.x, ks.z, Math.random()*6.3, 1.9);
  mkPier();
  if (env.lhPos) {
    buildingCols.push({x: env.lhPos.x, z: env.lhPos.z, r: 2.6});
    mkCrate(env.lhPos.x + 4, env.lhPos.z + 1);
    mkCrate(env.lhPos.x + 3, env.lhPos.z - 3);
  }
  for (let c = 0; c < 8; c++) {
    const s = beachSpot(14, 0.9, 3.0);
    if (!s) continue;
    mkParasol(s.x + (Math.random()-0.5)*4, s.z + (Math.random()-0.5)*4);
    mkChair(s.x + 1.6 + Math.random(), s.z + (Math.random()-0.5)*3, Math.random()*6.3);
    if (Math.random() < 0.7) mkChair(s.x - 1.8 - Math.random(), s.z + (Math.random()-0.5)*3, Math.random()*6.3);
    if (Math.random() < 0.5) mkCrate(s.x + (Math.random()-0.5)*8, s.z + (Math.random()-0.5)*8);
  }
  for (const s of hutSpots) if (Math.random() < 0.8) mkCrate(s.x + 3 + Math.random()*2, s.z + 2);
  // 白栅栏：沿路外侧（漂移甩尾的牺牲品）
  for (let f = 0; f < 6; f++) {
    const i0 = Math.floor(Math.random()*NS);
    const side = Math.random() < 0.5 ? 1 : -1;
    for (let k = 0; k < 3; k++) {
      const i = (i0 + k*4) % NS;
      const p = samples[i], n = normals[i], tg = tangents[i];
      mkFence(p.x + n.x*side*9.8, p.z + n.z*side*9.8, Math.atan2(tg.x, tg.z) + Math.PI/2);
    }
  }
  // 路牌
  for (let s2 = 0; s2 < 8; s2++) {
    const i = (Math.floor(s2*NS/8) + 20) % NS;
    const side = s2 % 2 ? 1 : -1;
    const p = samples[i], n = normals[i];
    mkSign(p.x + n.x*side*8.5, p.z + n.z*side*8.5, Math.atan2(-n.x*side, -n.z*side));
  }
  updateScoreChip();
  // —— 赛道道具：弯道路锥（可撞碎）/ 轮胎墙（软碰撞）/ 终点拱门
  const coneM = new THREE.MeshStandardMaterial({color:0xff6a13, roughness:0.6});
  const coneBaseM = new THREE.MeshStandardMaterial({color:0x222428, roughness:0.8});
  const coneG = new THREE.CylinderGeometry(0.045, 0.17, 0.52, 8); coneG.translate(0, 0.31, 0);
  const coneBaseG = new THREE.BoxGeometry(0.42, 0.06, 0.42); coneBaseG.translate(0, 0.03, 0);
  function mkCone(x, z) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(coneG, coneM));
    g.add(new THREE.Mesh(coneBaseG, coneBaseM));
    reg(g, x, z, 0, 0.35, 'cone');
  }
  const curv = [];
  for (let i = 0; i < NS; i += 8) {
    const t1 = tangents[i], t2 = tangents[(i+12) % NS];
    curv.push({i, c: 1 - (t1.x*t2.x + t1.z*t2.z)});
  }
  curv.sort((a, b) => b.c - a.c);
  const tyreM2 = new THREE.MeshStandardMaterial({color:0x16181c, roughness:0.95});
  const tyreBandM = new THREE.MeshStandardMaterial({color:0xe8e4da, roughness:0.8});
  const tyreG2 = new THREE.CylinderGeometry(0.36, 0.36, 0.25, 10);
  const used = [];
  for (const cv of curv) {
    if (used.length >= 4) break;
    if (used.some(u => Math.min(Math.abs(u - cv.i), NS - Math.abs(u - cv.i)) < 60)) continue;
    const i = cv.i;
    const dA0 = Math.min(Math.abs(i - BRANCH_A), NS - Math.abs(i - BRANCH_A));
    const dB0 = Math.min(Math.abs(i - BRANCH_B), NS - Math.abs(i - BRANCH_B));
    if (dA0 < 20 || dB0 < 20) continue; // 支线汇入口让位
    used.push(i);
    const p = samples[i], n = normals[i], tg = tangents[i];
    const p2 = samples[(i+12) % NS];
    const turnDir = Math.sign((p2.x - p.x)*n.x + (p2.z - p.z)*n.z) || 1;
    const out = -turnDir;
    // 弯外侧轮胎墙（3 组叠放，软碰撞）
    for (let k = -1; k <= 1; k++) {
      const j = (i + k*5 + NS) % NS;
      const pp = samples[j], nn = normals[j];
      const bx = pp.x + nn.x*out*(HALF_W + 2.2), bz = pp.z + nn.z*out*(HALF_W + 2.2);
      const by = surfaceHeight(bx, bz);
      const stack = new THREE.Group();
      for (const [ox, oy] of [[-0.4, 0.18], [0.4, 0.18], [0, 0.62]]) {
        const ty = new THREE.Mesh(tyreG2, oy > 0.3 ? tyreBandM : tyreM2);
        ty.rotation.z = Math.PI/2;
        ty.position.set(ox, oy, 0);
        stack.add(ty);
      }
      stack.position.set(bx, by, bz);
      stack.rotation.y = Math.atan2(tg.x, tg.z);
      stack.traverse(o => { if (o.isMesh) o.castShadow = true; });
      scene.add(stack);
      buildingCols.push({x: bx, z: bz, r: 1.0, soft: true});
    }
    // 弯内侧路肩锥桶
    for (let k = 0; k < 4; k++) {
      const j = (i + k*3 + NS) % NS;
      const pp = samples[j], nn = normals[j];
      mkCone(pp.x + nn.x*turnDir*(HALF_W - 0.5), pp.z + nn.z*turnDir*(HALF_W - 0.5));
    }
  }
  // 终点拱门（起跑线上方，XPENG 横幅）
  {
    const p = samples[0], n = normals[0];
    const archM = new THREE.MeshStandardMaterial({color:0x2a2e36, roughness:0.5, metalness:0.6});
    const arch = new THREE.Group();
    for (const s2 of [-1, 1]) {
      const py = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 0.5), archM);
      py.position.set(n.x*s2*(HALF_W + 0.9), 3.5, n.z*s2*(HALF_W + 0.9));
      arch.add(py);
      buildingCols.push({x: p.x + n.x*s2*(HALF_W + 0.9), z: p.z + n.z*s2*(HALF_W + 0.9), r: 0.7});
    }
    const beamLen = (HALF_W + 0.9)*2 + 0.5;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, beamLen), archM);
    beam.position.set(0, 7, 0);
    beam.lookAt(n.x, 7, n.z);
    arch.add(beam);
    const cv2 = document.createElement('canvas');
    cv2.width = 1024; cv2.height = 128;
    const cx2 = cv2.getContext('2d');
    cx2.fillStyle = '#0b1220'; cx2.fillRect(0, 0, 1024, 128);
    cx2.fillStyle = '#19d3ff'; cx2.fillRect(0, 0, 1024, 8);
    cx2.fillStyle = '#fff';
    cx2.font = 'italic 700 64px Arial';
    cx2.textAlign = 'center';
    cx2.fillText('XPENG · HORIZON COAST', 512, 86);
    const bt = new THREE.CanvasTexture(cv2);
    bt.colorSpace = THREE.SRGBColorSpace;
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(beamLen - 1, 1.2),
      new THREE.MeshBasicMaterial({map: bt, side: THREE.DoubleSide}));
    banner.position.set(0, 6.2, 0);
    banner.lookAt(tangents[0].x, 6.2, tangents[0].z);
    arch.add(banner);
    arch.position.set(p.x, p.y, p.z);
    arch.traverse(o => { if (o.isMesh) o.castShadow = true; });
    scene.add(arch);
  }
  // —— 悬崖护栏（轻薄栏杆：高速可直接冲破撞飞，支线汇入口自动让位）
  const rPostG = new THREE.BoxGeometry(0.18, 1.0, 0.18); rPostG.translate(0, 0.5, 0);
  const rPostM = new THREE.MeshStandardMaterial({color:0xc9ccd0, roughness:0.45, metalness:0.7});
  const rBeamM = new THREE.MeshStandardMaterial({color:0xaab0b6, roughness:0.4, metalness:0.8});
  for (let i = 0; i < NS; i += 8) {
    const dA = Math.min(Math.abs(i - BRANCH_A), NS - Math.abs(i - BRANCH_A));
    const dB = Math.min(Math.abs(i - BRANCH_B), NS - Math.abs(i - BRANCH_B));
    if (dA < 16 || dB < 16) continue;
    const p = samples[i], n = normals[i];
    const hL = islandBase(p.x + n.x*28, p.z + n.z*28);
    const hR = islandBase(p.x - n.x*28, p.z - n.z*28);
    const side = hL < hR ? 1 : -1;
    if (Math.min(hL, hR) > p.y - 4) continue;
    const j = (i + 8) % NS;
    const p2 = samples[j], n2 = normals[j];
    const off = HALF_W + 1.3;
    const ax = p.x + n.x*side*off, az = p.z + n.z*side*off;
    const bx2 = p2.x + n2.x*side*off, bz2 = p2.z + n2.z*side*off;
    const g = new THREE.Group();
    const post1 = new THREE.Mesh(rPostG, rPostM);
    g.add(post1);
    const post2 = new THREE.Mesh(rPostG, rPostM);
    post2.position.set(bx2 - ax, p2.y - p.y, bz2 - az);
    g.add(post2);
    const L = Math.hypot(bx2 - ax, bz2 - az);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.28, L + 0.1), rBeamM);
    beam.position.set((bx2 - ax)/2, 0.95 + (p2.y - p.y)/2, (bz2 - az)/2);
    g.add(beam);
    g.position.set(ax, p.y, az);
    scene.add(g);
    g.updateMatrixWorld(true);
    beam.lookAt(bx2, p2.y + 0.95, bz2);
    railSegs.push({ax, az, bx: bx2, bz: bz2, group: g, pieces: g.children.slice(), intact: true});
  }
  // —— 路线任务点：开进光圈停稳 3 秒自动开赛（探索式启动）
  const zoneColors = [0x19d3ff, 0xff9a3d, 0x7dff9a];
  zoneGrp = new THREE.Group();
  ROUTES.forEach((r, i) => {
    const p = samples[r.startIdx];
    const g = new THREE.Group();
    const ringG = new THREE.RingGeometry(4.2, 5.0, 36);
    ringG.rotateX(-Math.PI/2);
    const ring = new THREE.Mesh(ringG, new THREE.MeshBasicMaterial({color: zoneColors[i], transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false}));
    ring.position.set(p.x, p.y + 0.12, p.z);
    g.add(ring);
    const beam2 = new THREE.Mesh(
      new THREE.CylinderGeometry(5.2, 5.2, 30, 20, 1, true),
      new THREE.MeshBasicMaterial({color: zoneColors[i], transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide}));
    beam2.position.set(p.x, p.y + 13, p.z);
    g.add(beam2);
    const cv3 = document.createElement('canvas');
    cv3.width = 512; cv3.height = 128;
    const c3 = cv3.getContext('2d');
    c3.fillStyle = 'rgba(4,10,22,0.72)'; c3.fillRect(0, 0, 512, 128);
    c3.fillStyle = '#fff'; c3.font = '700 56px "Noto Sans SC", sans-serif'; c3.textAlign = 'center';
    c3.fillText(r.name, 256, 82);
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({map: new THREE.CanvasTexture(cv3), transparent: true, depthWrite: false}));
    tag.scale.set(12, 3, 1);
    tag.position.set(p.x, p.y + 9, p.z);
    g.add(tag);
    zoneGrp.add(g);
    zones.push({i, x: p.x, z: p.z, ring, hold: 0, color: zoneColors[i]});
  });
  scene.add(zoneGrp);
}

// ---------- 路线 / 检查点 / 竞速赛 / 战绩 / 成就 ----------
const GATE_W = HALF_W + 0.4;
function mkGate(pos, nrm, first) {
  const g = new THREE.Group();
  const pylonG = new THREE.CylinderGeometry(0.22, 0.3, 5.5, 8);
  const matA = new THREE.MeshBasicMaterial({color: first ? 0xffcf40 : 0x00e5ff, transparent: true, opacity: 0.9});
  for (const side of [-1, 1]) {
    const py = new THREE.Mesh(pylonG, matA);
    py.position.set(pos.x + nrm.x*side*GATE_W, pos.y + 2.75, pos.z + nrm.z*side*GATE_W);
    g.add(py);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, GATE_W*2), matA);
  beam.position.set(pos.x, pos.y + 5.6, pos.z);
  beam.lookAt(pos.x + nrm.x, pos.y + 5.6, pos.z + nrm.z);
  g.add(beam);
  g.userData = {mat: matA, pos: new THREE.Vector3(pos.x, pos.y, pos.z)};
  return g;
}
const ROUTES = [
  { id:'classic', name:'经典环线', loop:true, gold:78, silver:95, bronze:118, startIdx:0,
    gates: () => Array.from({length:10}, (_, i) => { const idx = i*(NS/10); return {p: samples[idx], n: normals[idx]}; }) },
  { id:'sprint', name:'黄昏冲刺', loop:false, gold:42, silver:52, bronze:66, startIdx:400,
    gates: () => [480, 560, 640, 720, 760].map(idx => ({p: samples[idx % NS], n: normals[idx % NS]})) },
  { id:'bridge', name:'跨谷挑战', loop:false, gold:40, silver:50, bronze:64, startIdx:120,
    gates: () => {
      const a = [50, 110, 170, 230].map(i => ({p: bSamples[i], n: bNormals[i]}));
      a.push({p: samples[480], n: normals[480]});
      return a;
    } }
];
const cpGroupAll = new THREE.Group();
scene.add(cpGroupAll);
cpGroupAll.visible = false;
const cps = []; // 全部门架（主循环浮动动画用）
for (const r of ROUTES) {
  r.grp = new THREE.Group();
  r.gateGroups = [];
  r.gates().forEach((d, i) => {
    const gate = mkGate(d.p, d.n, i === 0 && r.loop);
    r.grp.add(gate);
    r.gateGroups.push(gate);
    cps.push(gate);
  });
  r.grp.visible = false;
  cpGroupAll.add(r.grp);
}
const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.3, 4), new THREE.MeshBasicMaterial({color:0x00e5ff}));
arrow.rotation.x = Math.PI/2;
arrow.position.z = 0.6;
const arrowPivot = new THREE.Group();
arrowPivot.add(arrow);
scene.add(arrowPivot);
arrowPivot.visible = false;

// —— 战绩 / 成就持久化
let records = {};
let ach = {};
const stats = { smashes: 0 };
try { records = JSON.parse(localStorage.getItem('p7_records') || '{}'); } catch(e) {}
try { ach = JSON.parse(localStorage.getItem('p7_ach') || '{}'); } catch(e) {}
try { Object.assign(stats, JSON.parse(localStorage.getItem('p7_stats') || '{}')); } catch(e) {}
try { const legacy = parseFloat(localStorage.getItem('p7_best')); if (legacy && !records.classic) records.classic = { best: legacy }; } catch(e) {}
function saveRecords() {
  try {
    localStorage.setItem('p7_records', JSON.stringify(records));
    localStorage.setItem('p7_ach', JSON.stringify(ach));
    localStorage.setItem('p7_stats', JSON.stringify(stats));
  } catch(e) {}
}
const ACHS = [
  { id:'first',    icon:'🏁', name:'完赛者',     desc:'完成任意一场竞速' },
  { id:'gold1',    icon:'🥇', name:'金牌得主',   desc:'获得一枚金牌' },
  { id:'allgold',  icon:'👑', name:'海岸传奇',   desc:'三条路线全部金牌' },
  { id:'smash50',  icon:'💥', name:'拆迁艺术家', desc:'累计粉碎 50 个道具' },
  { id:'drift',    icon:'🌀', name:'漂移之王',   desc:'单次漂移得分 ≥ 400' },
  { id:'fly',      icon:'🛫', name:'飞行家',     desc:'完成一次大跳硬着陆' },
  { id:'combo5',   icon:'🔥', name:'连击大师',   desc:'连击达到 ×5' },
  { id:'score15k', icon:'💎', name:'计分狂人',   desc:'单局总分突破 15000' }
];
const MEDAL_ICON = { gold:'🥇', silver:'🥈', bronze:'🥉' };
function medalFor(route, t) {
  if (t <= route.gold) return 'gold';
  if (t <= route.silver) return 'silver';
  if (t <= route.bronze) return 'bronze';
  return null;
}
function unlockAch(id) {
  if (ach[id]) return;
  ach[id] = true;
  saveRecords();
  const a = ACHS.find(x => x.id === id);
  if (a) skillPop('🏆 成就解锁 · ' + a.name, true);
  refreshRecords();
}
function getRecordsView() {
  return { ROUTES, records, ach, ACHS, MEDAL_ICON, stats };
}
function getShareStats() {
  const r = records[race.route.id] || {};
  return {
    score,
    routeName: race.route.name,
    best: r.best ? fmt(r.best) : '—',
    medal: r.medal ? MEDAL_ICON[r.medal] : ''
  };
}

// —— 幽灵车 / 起跑灯带 / 差值显示
let ghostObj = null, ghostData = null, recSamples = null, lastRecT = 0;
function setLights(n, go) {
  const el = document.getElementById('lights');
  if (!el) return;
  el.style.display = (n > 0 || go) ? 'flex' : 'none';
  el.querySelectorAll('i').forEach((d, i2) => {
    d.className = go ? 'go' : (i2 < n ? 'on' : '');
  });
  if (go) setTimeout(() => { el.style.display = 'none'; }, 900);
}
let deltaTimer = null;
function showDelta(d) {
  const el = document.getElementById('delta');
  if (!el) return;
  el.textContent = (d >= 0 ? '+' : '') + d.toFixed(2);
  el.style.color = d <= 0 ? '#7dff9a' : '#ff8a72';
  el.style.opacity = 1;
  clearTimeout(deltaTimer);
  deltaTimer = setTimeout(() => { el.style.opacity = 0; }, 1800);
}

// —— 竞速状态机
const race = { phase:'free', routeIdx:0, route:ROUTES[0], targets:[], ti:0, t0:0, time:0, count:0, pauseT:0 };
const raceBox = document.getElementById('racebox');
function selectRoute(i) {
  race.routeIdx = Math.max(0, Math.min(ROUTES.length - 1, i|0));
  race.route = ROUTES[race.routeIdx];
}
function startRace() {
  const r = race.route;
  const si = r.startIdx;
  const dsx = state.pos.x - samples[si].x, dsz = state.pos.z - samples[si].z;
  if (dsx*dsx + dsz*dsz > 64) state.pos.set(samples[si].x, samples[si].y + 0.05, samples[si].z);
  state.heading = state.travel = Math.atan2(tangents[si].x, tangents[si].z);
  state.speed = 0; state.vx = 0; state.vz = 0; state.nitro = 1;
  race.phase = 'countdown'; race.count = 3;
  race.targets = r.loop ? [...r.gateGroups.slice(1), r.gateGroups[0]] : r.gateGroups;
  race.ti = 0;
  race.splits = [];
  recSamples = [];
  lastRecT = 0;
  ghostData = (records[r.id] && records[r.id].ghost) || null;
  if (ghostData && !ghostObj) ghostObj = createGhostClone();
  if (ghostObj) ghostObj.visible = false;
  setLights(0, false);
  for (const rr of ROUTES) rr.grp.visible = rr === r;
  cpGroupAll.visible = true;
  arrowPivot.visible = true;
  raceBox.style.display = 'block';
  updateCpColors();
  countdownTick();
}
function endRace() {
  race.phase = 'free';
  if (ghostObj) ghostObj.visible = false;
  setLights(0, false);
  cpGroupAll.visible = false;
  arrowPivot.visible = false;
  raceBox.style.display = 'none';
  showMsg('自由漫游', 1000, 30);
}
function toggleRace() {
  if (G.appState !== 'drive') return;
  race.phase === 'free' ? startRace() : endRace();
}
function countdownTick() {
  if (race.phase !== 'countdown') return;
  if (G.appState === 'pause' || G.appState === 'photo') { setTimeout(countdownTick, 300); return; }
  if (race.count > 0) {
    showMsg(String(race.count), 850, 90);
    setLights(4 - race.count, false);
    race.count--;
    setTimeout(countdownTick, 1000);
  } else {
    showMsg('GO!', 800, 90);
    setLights(3, true);
    race.phase = 'racing';
    race.t0 = performance.now();
  }
}
function updateCpColors() {
  race.route.gateGroups.forEach((g) => {
    const isNext = race.targets[race.ti] === g;
    g.userData.mat.color.setHex(isNext ? 0x76ff03 : 0x00e5ff);
    g.userData.mat.opacity = isNext ? 1 : 0.35;
  });
}
function finishRace(t) {
  const r = race.route;
  const med = medalFor(r, t);
  const rec = records[r.id] || {};
  const isPB = !rec.best || t < rec.best;
  if (isPB) {
    rec.best = t;
    if (recSamples && recSamples.length > 8) rec.ghost = recSamples;
    rec.splits = race.splits.slice();
  }
  const order = { gold: 3, silver: 2, bronze: 1 };
  if (med && (order[med] > (order[rec.medal] || 0))) rec.medal = med;
  records[r.id] = rec;
  saveRecords();
  showMsg('完赛 ' + fmt(t) + (med ? '  ' + MEDAL_ICON[med] : '') + (isPB ? ' · 新纪录!' : ''), 3000, 42);
  unlockAch('first');
  if (med === 'gold') unlockAch('gold1');
  if (ROUTES.every(x => records[x.id] && records[x.id].medal === 'gold')) unlockAch('allgold');
  refreshRecords();
  race.phase = 'done';
  setTimeout(() => { if (race.phase === 'done') endRace(); }, 2600);
}
function raceUpdate() {
  if (race.phase !== 'racing') return;
  race.time = (performance.now() - race.t0) / 1000;
  const target = race.targets[race.ti];
  if (!target) return;
  const tp = target.userData.pos;
  const dx = state.pos.x - tp.x, dz = state.pos.z - tp.z;
  // PB 幽灵回放（10Hz 采样线性插值）
  if (ghostObj && ghostData) {
    const fi = race.time / 0.1;
    const maxI = ghostData.length/4 - 2;
    if (fi < maxI) {
      const i0 = Math.floor(fi), f2 = fi - i0;
      const a2 = i0*4, b2 = a2 + 4;
      ghostObj.visible = true;
      ghostObj.position.set(
        ghostData[a2] + (ghostData[b2] - ghostData[a2])*f2,
        ghostData[a2+1] + (ghostData[b2+1] - ghostData[a2+1])*f2,
        ghostData[a2+2] + (ghostData[b2+2] - ghostData[a2+2])*f2);
      const dh2 = wrapPi(ghostData[b2+3] - ghostData[a2+3]);
      ghostObj.rotation.set(0, ghostData[a2+3] + dh2*f2, 0);
    } else ghostObj.visible = false;
  }
  // 路径录制 10Hz
  if (recSamples && race.time - lastRecT >= 0.1) {
    lastRecT = race.time;
    recSamples.push(+state.pos.x.toFixed(2), +state.pos.y.toFixed(2), +state.pos.z.toFixed(2), +state.heading.toFixed(3));
  }
  if (dx*dx + dz*dz < 100) {
    race.splits.push(race.time);
    const rec0 = records[race.route.id];
    if (rec0 && rec0.splits && rec0.splits[race.ti] != null) showDelta(race.time - rec0.splits[race.ti]);
    race.ti++;
    if (race.ti >= race.targets.length) { finishRace(race.time); return; }
    showMsg('检查点 ' + race.ti + '/' + race.targets.length, 700, 30);
    updateCpColors();
  }
  const nt = race.targets[Math.min(race.ti, race.targets.length - 1)].userData.pos;
  arrowPivot.position.set(state.pos.x, state.pos.y + 3.2, state.pos.z);
  arrowPivot.lookAt(nt.x, state.pos.y + 3.2, nt.z);
}
function raceBestText() {
  const r = records[race.route.id];
  return r && r.best ? '最佳: ' + fmt(r.best) + (r.medal ? ' ' + MEDAL_ICON[r.medal] : '') : '';
}
function fmt(t) {
  const m = Math.floor(t/60), s = t - m*60;
  return m + ':' + (s<10?'0':'') + s.toFixed(2);
}

export { sfx, skillPop, saveBestScore, gameplayUpdate, buildProps, race, toggleRace, startRace, endRace, raceUpdate, fmt, cps, cpGroupAll, arrow, arrowPivot, ROUTES, selectRoute, getRecordsView, getShareStats, raceBestText, unlockAch, spawnBreakDebris, zones };
