import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { G, scene, camera, canvas, wrapPi } from './core.js';
import { surfaceHeight } from './world.js';
import { state } from './vehicle.js';
import { keys } from './ui.js';

// ---------- 多角色可控步行系统（Mixamo 合并资产） ----------
// 角色注册表：Cici（基础 idle/walk/run/jump）与 IRON（额外含 jumpdown/roll/enter/exit/driving/runjump）。
// 两个角色在启动时一并预载、加入同一 charRoot，仅激活者可见；车库内站立播放 idle 作为选人预览，
// 切换角色即实时替换模型（无需重载场景）。
export const CHARACTERS = [
  { id: 'cici', name: 'Cici', sub: '轻盈 · 灵动', url: 'assets/character.glb', targetH: 1.74 },
  { id: 'iron', name: 'IRON', sub: '硬核 · 全动作', url: 'assets/iron.glb', targetH: 1.84 },
];
const ONESHOT = ['jump', 'jumpdown', 'roll', 'enter', 'exit', 'runjump'];

const TARGET_H = 1.78;
const WALK_SPEED = 1.8;
const RUN_SPEED = 5.2;
const FORWARD_OFFSET = 0;     // 朝向修正：若角色"倒着走"，改成 Math.PI

// 相机（鼠标右摇杆式自由视角）——过肩近景（God of War / 原神 风格）
const CAM_DIST = 2.85, CAM_EYE = 1.5, LOOK_H = 1.45, SHOULDER = 0.62;
const MOUSE_SENS = 0.0026;
let camYaw = 0, camPitch = 0.22;

export const charRoot = new THREE.Group();
charRoot.visible = false;
scene.add(charRoot);

export const charState = {
  pos: new THREE.Vector3(), heading: 0, speed: 0, vyAir: 0, airborne: false, ready: false
};

// 每个角色的运行时记录：{ root, model, mixer, actions, current, ready }
const records = {};
let activeId = CHARACTERS[0].id;
let prevJump = false;
let previewMode = false;

function rec() { return records[activeId]; }
export function getActiveId() { return activeId; }

function play(name, fade = 0.18) {
  const r = rec();
  if (!r || !r.ready) return;
  if (r.current === name || !r.actions[name]) return;
  const next = r.actions[name];
  next.reset().setEffectiveWeight(1).fadeIn(fade).play();
  if (r.current && r.actions[r.current]) r.actions[r.current].fadeOut(fade);
  r.current = name;
}

// —— 鼠标右摇杆：点击进入指针锁定，移动鼠标转动镜头 ——
function initMouseLook() {
  canvas.addEventListener('pointerdown', () => {
    if (G.appState === 'walk' && !document.pointerLockElement) canvas.requestPointerLock?.();
  });
  addEventListener('mousemove', (e) => {
    if (G.appState !== 'walk' || !document.pointerLockElement) return;
    camYaw -= e.movementX * MOUSE_SENS;
    camPitch = THREE.MathUtils.clamp(camPitch + e.movementY * MOUSE_SENS, -0.15, 1.0);
  });
}

function buildOne(def) {
  return new Promise((resolve) => {
    const loader = new GLTFLoader();
    loader.load(def.url, (gltf) => {
      const model = gltf.scene;
      const root = new THREE.Group();   // 每个角色独立子组，便于显隐与替换
      root.visible = false;
      model.updateMatrixWorld(true);
      // 缩放到目标身高（模型本身 Y-up 直立）
      let box = new THREE.Box3().setFromObject(model);
      let size = box.getSize(new THREE.Vector3());
      model.scale.setScalar((def.targetH || TARGET_H) / Math.max(size.y, 0.001));
      model.updateMatrixWorld(true);
      // 居中 X/Z、脚底落到 y=0
      box = new THREE.Box3().setFromObject(model);
      const ctr = box.getCenter(new THREE.Vector3());
      model.position.x -= ctr.x;
      model.position.z -= ctr.z;
      model.position.y -= box.min.y;
      model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
      root.add(model);
      charRoot.add(root);

      const mixer = new THREE.AnimationMixer(model);
      const actions = {};
      for (const clip of gltf.animations) {
        const a = mixer.clipAction(clip);
        actions[clip.name] = a;
        if (ONESHOT.includes(clip.name)) { a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true; }
      }
      if (actions['idle']) { actions['idle'].play(); }
      records[def.id] = { root, model, mixer, actions, current: 'idle', ready: true };
      if (def.id === activeId) {
        charState.ready = true;
        if (previewMode) { root.visible = charRoot.visible; placePreview(); } // 加载完成即补上预览
      }
      resolve();
    }, undefined, (err) => { console.warn('角色模型加载失败：', def.url, err); resolve(); });
  });
}

export async function buildCharacter() {
  initMouseLook();
  // 恢复上次选择（直接读存档，避免与 initUI 加载顺序耦合）
  try {
    const s = JSON.parse(localStorage.getItem('p7_set') || '{}');
    if (s.charId && CHARACTERS.some(c => c.id === s.charId)) activeId = s.charId;
  } catch (e) {}
  if (G.charId && CHARACTERS.some(c => c.id === G.charId)) activeId = G.charId;
  G.charId = activeId;
  // 并行预载全部角色（互不阻塞）
  await Promise.all(CHARACTERS.map(buildOne));
}

// 设置当前激活角色（车库选人 / 进入步行前）；实时替换可见模型
export function setActiveCharacter(id) {
  if (!CHARACTERS.some(c => c.id === id)) return;
  activeId = id;
  G.charId = id;
  for (const cid in records) records[cid].root.visible = (cid === id) && charRoot.visible;
  const r = rec();
  charState.ready = !!(r && r.ready);
  if (r && r.ready) { play('idle', 0.12); }
  if (previewMode) placePreview();
}

// ——— 车库选人预览：让激活角色站在车旁播放 idle ———
export function showCharacterPreview(on) {
  previewMode = on;
  charRoot.visible = on;
  for (const cid in records) records[cid].root.visible = on && (cid === activeId);
  if (on) { placePreview(); play('idle', 0.0); }
}
function placePreview() {
  // 站在车的左前方，面向车头方向的斜前侧，便于环绕镜头看清
  const h = state.heading;
  const lx = Math.cos(h), lz = -Math.sin(h);           // 车体左向
  const fx = Math.sin(h), fz = Math.cos(h);            // 车头前向
  const px = state.pos.x + lx * 2.2 + fx * 0.6;
  const pz = state.pos.z + lz * 2.2 + fz * 0.6;
  charState.pos.set(px, surfaceHeight(px, pz), pz);
  charState.heading = h + Math.PI * 0.5;               // 侧身朝向车，姿态更立体
  charRoot.position.copy(charState.pos);
  charRoot.rotation.y = charState.heading + FORWARD_OFFSET;
}
// 车库内每帧推进 idle 动画（主循环在 garage 分支调用）
export function characterPreviewUpdate(dt) {
  const r = rec();
  if (previewMode && r && r.ready) r.mixer.update(dt);
}

export function spawnCharacter(x, z, heading) {
  const r = rec();
  if (!r || !r.ready) return false;
  previewMode = false;
  charState.pos.set(x, surfaceHeight(x, z), z);
  charState.heading = heading;
  charState.speed = 0; charState.vyAir = 0; charState.airborne = false;
  camYaw = heading; camPitch = 0.32;
  charRoot.visible = true;
  for (const cid in records) records[cid].root.visible = (cid === activeId);
  play('idle', 0.1);
  return true;
}

export function setCharacterVisible(v) {
  charRoot.visible = v;
  if (!v) previewMode = false;
  if (!v && document.pointerLockElement) document.exitPointerLock?.();
}

export function characterUpdate(dt) {
  const r = rec();
  if (!r || !r.ready) return;
  const actions = r.actions;
  const s = charState;
  const fwd = keys['KeyW'] || keys['ArrowUp'];
  const back = keys['KeyS'] || keys['ArrowDown'];
  const left = keys['KeyA'] || keys['ArrowLeft'];
  const right = keys['KeyD'] || keys['ArrowRight'];
  const running = keys['ShiftLeft'] || keys['ShiftRight'];
  const jump = keys['Space'];

  // 移动方向 = 相对镜头朝向（WASD 左摇杆）
  const cf = new THREE.Vector3(Math.sin(camYaw), 0, Math.cos(camYaw));
  const cr = new THREE.Vector3(-Math.cos(camYaw), 0, Math.sin(camYaw));
  const move = new THREE.Vector3();
  if (fwd) move.add(cf);
  if (back) move.sub(cf);
  if (right) move.add(cr);
  if (left) move.sub(cr);

  const moving = move.lengthSq() > 1e-4;
  const targetSpeed = moving ? (running ? RUN_SPEED : WALK_SPEED) : 0;
  s.speed += (targetSpeed - s.speed) * Math.min(1, dt * 8);
  if (s.speed < 0.05) s.speed = 0;

  if (moving) {
    move.normalize();
    const targetHeading = Math.atan2(move.x, move.z);
    s.heading += wrapPi(targetHeading - s.heading) * Math.min(1, dt * 12);
    s.pos.x += move.x * s.speed * dt;
    s.pos.z += move.z * s.speed * dt;
  }

  const gy = surfaceHeight(s.pos.x, s.pos.z);
  if (s.airborne) {
    s.vyAir -= 18 * dt;
    s.pos.y += s.vyAir * dt;
    if (s.pos.y <= gy) { s.pos.y = gy; s.vyAir = 0; s.airborne = false; }
  } else {
    s.pos.y = gy;
    if (jump && !prevJump) { s.airborne = true; s.vyAir = 5.4; }
  }
  prevJump = jump;

  // 动画状态机
  let want;
  if (s.airborne) want = actions['jump'] ? 'jump' : (r.current || 'idle');
  else if (s.speed < 0.2) want = 'idle';
  else if (s.speed < (WALK_SPEED + RUN_SPEED) * 0.5) want = 'walk';
  else want = 'run';
  play(want);
  if (actions['walk']) actions['walk'].setEffectiveTimeScale(THREE.MathUtils.clamp(s.speed / WALK_SPEED, 0.6, 1.6));
  if (actions['run']) actions['run'].setEffectiveTimeScale(THREE.MathUtils.clamp(s.speed / RUN_SPEED, 0.7, 1.4));

  charRoot.position.copy(s.pos);
  charRoot.rotation.y = s.heading + FORWARD_OFFSET;
  r.mixer.update(dt);
}

const camWant = new THREE.Vector3();
export function characterCamera(dt) {
  const s = charState;
  const rx = -Math.cos(camYaw), rz = Math.sin(camYaw);
  const horiz = CAM_DIST * Math.cos(camPitch);
  camWant.set(
    s.pos.x - Math.sin(camYaw) * horiz + rx * SHOULDER,
    s.pos.y + CAM_EYE + Math.sin(camPitch) * CAM_DIST,
    s.pos.z - Math.cos(camYaw) * horiz + rz * SHOULDER
  );
  camera.position.lerp(camWant, Math.min(1, dt * 10));
  const cg = surfaceHeight(camera.position.x, camera.position.z) + 0.4;
  if (camera.position.y < cg) camera.position.y = cg;
  camera.lookAt(s.pos.x + rx * SHOULDER * 0.5, s.pos.y + LOOK_H, s.pos.z + rz * SHOULDER * 0.5);
  if (camera.fov !== 70) { camera.fov += (70 - camera.fov) * Math.min(1, dt * 4); camera.updateProjectionMatrix(); }
}
