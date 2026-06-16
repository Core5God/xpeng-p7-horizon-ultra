import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { G, scene, camera, canvas, wrapPi } from './core.js';
import { surfaceHeight } from './world.js';
import { keys } from './ui.js';

// ---------- 可控步行角色（Mixamo 合并资产：idle/walk/run/jump/turn/startstop） ----------
const CHAR_URL = 'assets/character.glb';
const TARGET_H = 1.78;        // 角色目标身高（米），按包围盒自动缩放
const WALK_SPEED = 1.8;
const RUN_SPEED = 5.2;
const FORWARD_OFFSET = 0;     // 朝向修正：若角色"倒着走"，改成 Math.PI

// 相机（鼠标右摇杆式自由视角）——过肩近景（God of War / 原神 风格）：
// 更近 + 横向偏移到右肩，角色落在画面左侧，代入感更强
const CAM_DIST = 2.85, CAM_EYE = 1.5, LOOK_H = 1.45, SHOULDER = 0.62;
const MOUSE_SENS = 0.0026;
let camYaw = 0, camPitch = 0.22;

export const charRoot = new THREE.Group();
charRoot.visible = false;
scene.add(charRoot);

export const charState = {
  pos: new THREE.Vector3(), heading: 0, speed: 0, vyAir: 0, airborne: false, ready: false
};

let mixer = null;
const actions = {};
let current = null;
let prevJump = false;
let model = null;

function play(name, fade = 0.18) {
  if (current === name || !actions[name]) return;
  const next = actions[name];
  next.reset().setEffectiveWeight(1).fadeIn(fade).play();
  if (current && actions[current]) actions[current].fadeOut(fade);
  current = name;
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

export function buildCharacter() {
  initMouseLook();
  const loader = new GLTFLoader();
  loader.load(CHAR_URL, (gltf) => {
    model = gltf.scene;
    model.updateMatrixWorld(true);
    // 缩放到目标身高（模型本身为 Y-up 直立，无需翻转）
    let box = new THREE.Box3().setFromObject(model);
    let size = box.getSize(new THREE.Vector3());
    model.scale.setScalar(TARGET_H / Math.max(size.y, 0.001));
    model.updateMatrixWorld(true);
    // 居中 X/Z、脚底落到 y=0
    box = new THREE.Box3().setFromObject(model);
    const ctr = box.getCenter(new THREE.Vector3());
    model.position.x -= ctr.x;
    model.position.z -= ctr.z;
    model.position.y -= box.min.y;
    model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    charRoot.add(model);

    mixer = new THREE.AnimationMixer(model);
    for (const clip of gltf.animations) {
      const a = mixer.clipAction(clip);
      actions[clip.name] = a;
      if (clip.name === 'jump') { a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true; }
    }
    if (actions['idle']) { actions['idle'].play(); current = 'idle'; }
    charState.ready = true;
  }, undefined, (err) => console.warn('角色模型加载失败：', err));
}

export function spawnCharacter(x, z, heading) {
  if (!charState.ready) return false;
  charState.pos.set(x, surfaceHeight(x, z), z);
  charState.heading = heading;
  charState.speed = 0; charState.vyAir = 0; charState.airborne = false;
  camYaw = heading; camPitch = 0.32;
  charRoot.visible = true;
  return true;
}

export function setCharacterVisible(v) {
  charRoot.visible = v;
  if (!v && document.pointerLockElement) document.exitPointerLock?.();
}

export function characterUpdate(dt) {
  if (!charState.ready) return;
  const s = charState;
  const fwd = keys['KeyW'] || keys['ArrowUp'];
  const back = keys['KeyS'] || keys['ArrowDown'];
  const left = keys['KeyA'] || keys['ArrowLeft'];
  const right = keys['KeyD'] || keys['ArrowRight'];
  const running = keys['ShiftLeft'] || keys['ShiftRight'];
  const jump = keys['Space'];

  // 移动方向 = 相对镜头朝向（WASD 左摇杆）。
  // 前向 = 镜头看向场景的水平方向；右向 = 屏幕右方（标准右手系下为 (-cos, 0, sin)）
  const cf = new THREE.Vector3(Math.sin(camYaw), 0, Math.cos(camYaw)); // 镜头前向（W 进屏幕）
  const cr = new THREE.Vector3(-Math.cos(camYaw), 0, Math.sin(camYaw)); // 镜头右向（D 屏幕向右）
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
  if (s.airborne) want = actions['jump'] ? 'jump' : (current || 'idle');
  else if (s.speed < 0.2) want = 'idle';
  else if (s.speed < (WALK_SPEED + RUN_SPEED) * 0.5) want = 'walk';
  else want = 'run';
  play(want);
  if (actions['walk']) actions['walk'].setEffectiveTimeScale(THREE.MathUtils.clamp(s.speed / WALK_SPEED, 0.6, 1.6));
  if (actions['run']) actions['run'].setEffectiveTimeScale(THREE.MathUtils.clamp(s.speed / RUN_SPEED, 0.7, 1.4));

  charRoot.position.copy(s.pos);
  charRoot.rotation.y = s.heading + FORWARD_OFFSET;
  mixer.update(dt);
}

const camWant = new THREE.Vector3();
export function characterCamera(dt) {
  const s = charState;
  const rx = -Math.cos(camYaw), rz = Math.sin(camYaw); // 相机右向（用于过肩横移）
  const horiz = CAM_DIST * Math.cos(camPitch);
  // 相机置于角色右后上方 + 右肩横移 → 角色落在画面左侧（过肩视角）
  camWant.set(
    s.pos.x - Math.sin(camYaw) * horiz + rx * SHOULDER,
    s.pos.y + CAM_EYE + Math.sin(camPitch) * CAM_DIST,
    s.pos.z - Math.cos(camYaw) * horiz + rz * SHOULDER
  );
  camera.position.lerp(camWant, Math.min(1, dt * 10));
  const cg = surfaceHeight(camera.position.x, camera.position.z) + 0.4;
  if (camera.position.y < cg) camera.position.y = cg;
  // 注视点也轻微右移，保持过肩构图舒适
  camera.lookAt(s.pos.x + rx * SHOULDER * 0.5, s.pos.y + LOOK_H, s.pos.z + rz * SHOULDER * 0.5);
  if (camera.fov !== 70) { camera.fov += (70 - camera.fov) * Math.min(1, dt * 4); camera.updateProjectionMatrix(); }
}
