import * as THREE from 'three';
import { G, scene } from './core.js';
import { state } from './vehicle.js';
import { keys } from './ui.js';

// ---------- 特效：漂移烟雾 / 越野尘土 ----------
// 注：性能模式（SHIFT）为电车高性能输出概念，无氮气喷焰视觉

const POOL = 42;
const puffs = [];
let cursor = 0, spawnAcc = 0;

function makePuffTex() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const x = cv.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}

export function initFX() {
  const tex = makePuffTex();
  for (let i = 0; i < POOL; i++) {
    const m = new THREE.SpriteMaterial({map: tex, transparent: true, opacity: 0, depthWrite: false});
    const s = new THREE.Sprite(m);
    s.visible = false;
    scene.add(s);
    puffs.push({s, life: 0, max: 1, vx: 0, vy: 0, vz: 0, grow: 2.4});
  }
}

function spawn(x, y, z, color, size, up) {
  const p = puffs[cursor];
  cursor = (cursor + 1) % POOL;
  p.s.visible = true;
  p.s.position.set(x, y, z);
  p.s.material.color.setHex(color);
  p.s.material.opacity = 0.45;
  p.s.scale.setScalar(size);
  p.life = p.max = 0.9 + Math.random() * 0.5;
  p.vx = (Math.random() - 0.5) * 1.2 + state.vx * 0.12;
  p.vz = (Math.random() - 0.5) * 1.2 + state.vz * 0.12;
  p.vy = up + Math.random() * 0.8;
}

export function fxUpdate(dt, onRoad, boost) {
  const fx2 = Math.sin(state.heading), fz2 = Math.cos(state.heading);
  const vLat = state.vx * fz2 - state.vz * fx2;
  const spd = Math.hypot(state.vx, state.vz);
  const drifting = G.appState === 'drive' && keys['Space'] && onRoad && Math.abs(vLat) > 3.5 && spd > 8;
  const dusty = G.appState === 'drive' && !onRoad && spd > 9 && !state.airborne;
  if (drifting || dusty) {
    spawnAcc += dt * (drifting ? 38 : 22);
    if (!isFinite(spawnAcc)) spawnAcc = 0;
    while (spawnAcc >= 1) {
      spawnAcc -= 1;
      for (const sx of [-0.85, 0.85]) {
        const wx = state.pos.x + fx2 * (-1.45) + fz2 * sx;
        const wz = state.pos.z + fz2 * (-1.45) - fx2 * sx;
        spawn(wx, state.pos.y + 0.25, wz,
              drifting ? 0xcfd2d6 : 0xb9a071,
              0.5 + Math.random() * 0.4,
              drifting ? 0.6 : 0.9);
      }
    }
  } else {
    spawnAcc = 0;
  }
  for (const p of puffs) {
    if (!p.s.visible) continue;
    p.life -= dt;
    if (p.life <= 0) { p.s.visible = false; continue; }
    p.s.position.x += p.vx * dt;
    p.s.position.y += p.vy * dt;
    p.s.position.z += p.vz * dt;
    p.s.material.opacity = 0.45 * (p.life / p.max);
    p.s.scale.multiplyScalar(1 + p.grow * dt * 0.5);
  }
}
